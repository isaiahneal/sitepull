import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CAPTURE_STAGES } from '@sitepull/contracts';
import { exportCaptureArchive, runCapture } from '@sitepull/core';

let fixture: ChildProcessWithoutNullStreams;
let fixtureUrl: string;
const roots: string[] = [];

async function startFixture(): Promise<{ process: ChildProcessWithoutNullStreams; url: string }> {
  const child = spawn(process.execPath, ['fixtures/server.mjs'], {
    cwd: path.resolve('.'),
    env: { ...process.env, SITEPULL_FIXTURE_PORT: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Fixture server did not announce its URL.')),
      10_000,
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      const match = /SITEPULL_FIXTURE_URL=(http:\/\/[^\s]+)/u.exec(output);
      if (match?.[1] !== undefined) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Fixture server exited early with code ${String(code)}.`));
    });
  });
  return { process: child, url };
}

function pngDimensions(data: Buffer): { width: number; height: number } {
  expect(data.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

beforeAll(async () => {
  const started = await startFixture();
  fixture = started.process;
  fixtureUrl = started.url;
});

afterAll(async () => {
  fixture?.kill('SIGTERM');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('deterministic fixture crawl', () => {
  it('retries HTTP only when HTTPS was inferred for a bare host', async () => {
    const outputRoot = path.join(os.tmpdir(), `sitepull-fallback-${crypto.randomUUID()}`);
    roots.push(outputRoot);
    await mkdir(outputRoot);
    const inferredHttpsUrl = fixtureUrl.replace(/^http:/u, 'https:');
    const result = await runCapture(
      {
        url: inferredHttpsUrl,
        allowHttpFallback: true,
        outputDirectory: outputRoot,
        config: {
          maxDepth: 0,
          maxPages: 1,
          pageTimeoutMs: 8_000,
          viewports: [{ name: 'mobile', width: 390, height: 844 }],
        },
      },
      { allowPrivateHosts: true },
    );

    expect(result.summary.sourceUrl).toBe(new URL(inferredHttpsUrl).href);
    expect(result.summary.normalizedUrl).toBe(new URL(fixtureUrl).href);
    expect(result.summary.counts.pages).toBe(1);
  }, 30_000);

  it('captures hydrated routes, lazy DOM, resources, design evidence, screenshots, and a compact AI Pack', async () => {
    const outputRoot = path.join(os.tmpdir(), `sitepull-integration-${crypto.randomUUID()}`);
    roots.push(outputRoot);
    await mkdir(outputRoot);
    const events: string[] = [];
    const completedStages = new Set<string>();
    const result = await runCapture(
      {
        url: fixtureUrl,
        outputDirectory: outputRoot,
        config: {
          engine: 'webkit',
          maxDepth: 1,
          maxPages: 12,
          crawlConcurrency: 3,
          pageTimeoutMs: 15_000,
          maxElementsPerPage: 2_000,
          viewports: [
            { name: 'desktop', width: 1_440, height: 600 },
            { name: 'mobile', width: 390, height: 844 },
          ],
        },
      },
      {
        allowPrivateHosts: true,
        onEvent: (event) => {
          events.push(event.type === 'progress' ? event.stage : event.type);
          if (event.type === 'progress' && event.state === 'completed') {
            completedStages.add(event.stage);
          }
        },
      },
    );

    expect(result.summary.status).toBe('completed');
    expect(result.summary.counts.pages).toBeGreaterThanOrEqual(2);
    expect(result.manifest.pages.some((page) => page.route === '/about')).toBe(true);
    expect(events).toContain('analyzing-design-system');
    expect([...completedStages].sort()).toEqual([...CAPTURE_STAGES].sort());
    expect(events.at(-1)).toBe('complete');
    const home = result.manifest.pages.find((page) => page.route === '/');
    expect(home?.files).not.toBeNull();
    const homeHtml = await readFile(
      path.join(result.outputDirectory, home?.files?.renderedHtml ?? ''),
      'utf8',
    );
    expect(homeHtml).toContain('The bottom of the page arrived only after scrolling.');
    expect(homeHtml).toContain('data-component="feature-card"');

    const capturedKinds = new Set(
      result.manifest.resources
        .filter((resource) => resource.captured)
        .map((resource) => resource.kind),
    );
    for (const kind of ['css', 'javascript', 'font', 'svg', 'image', 'source-map'] as const) {
      expect(capturedKinds.has(kind), `expected captured ${kind}`).toBe(true);
    }
    const duplicateImages = result.manifest.resources.filter((resource) =>
      /checker-[ab]\.png$/u.test(new URL(resource.originalUrl).pathname),
    );
    expect(duplicateImages).toHaveLength(2);
    expect(duplicateImages[0]?.sha256).toBe(duplicateImages[1]?.sha256);
    expect(duplicateImages[0]?.localPath).toBe(duplicateImages[1]?.localPath);

    expect(
      result.manifest.design.cssVariables.some((token) => token.name === '--color-canvas'),
    ).toBe(true);
    expect(result.manifest.design.colors.length).toBeGreaterThan(4);
    expect(result.manifest.design.components.some((candidate) => candidate.occurrences >= 3)).toBe(
      true,
    );
    expect(result.manifest.skippedUrls.some((entry) => entry.reason === 'external-origin')).toBe(
      true,
    );
    expect(
      result.manifest.skippedUrls.some((entry) => entry.reason === 'query-variant-limit'),
    ).toBe(true);

    const desktop = home?.screenshots.find((screenshot) => screenshot.viewport.name === 'desktop');
    const mobile = home?.screenshots.find((screenshot) => screenshot.viewport.name === 'mobile');
    expect(
      pngDimensions(await readFile(path.join(result.outputDirectory, desktop?.viewportPath ?? ''))),
    ).toEqual({ width: 1_440, height: 600 });
    expect(
      pngDimensions(await readFile(path.join(result.outputDirectory, mobile?.viewportPath ?? ''))),
    ).toEqual({ width: 390, height: 844 });

    const aiContext = await readFile(path.join(result.outputDirectory, 'AI_CONTEXT.md'), 'utf8');
    expect(aiContext).toContain('# Sitepull Reference');
    expect(aiContext).toContain('Repeated Component Candidates');
    const exported = await exportCaptureArchive({
      captureRoot: result.outputDirectory,
      mode: 'ai-pack',
    });
    expect(exported.compressedBytes).toBeGreaterThan(1_000);
    expect(exported.files).toContain('AI_CONTEXT.md');
    expect(exported.files.some((file) => file.startsWith('raw/javascript/'))).toBe(false);
  }, 60_000);

  it('retries transient HTTP pages, honors Retry-After, and preserves permanent failure evidence', async () => {
    const outputRoot = path.join(os.tmpdir(), `sitepull-retry-${crypto.randomUUID()}`);
    roots.push(outputRoot);
    await mkdir(outputRoot);
    const testCase = crypto.randomUUID();
    const result = await runCapture(
      {
        url: `${fixtureUrl}/retry-suite?case=${testCase}`,
        outputDirectory: outputRoot,
        config: {
          maxDepth: 1,
          maxPages: 4,
          crawlConcurrency: 3,
          pageTimeoutMs: 10_000,
          viewports: [{ name: 'desktop', width: 800, height: 600 }],
        },
      },
      { allowPrivateHosts: true },
    );

    const pageFor = (pathname: string) =>
      result.manifest.pages.find((page) => new URL(page.url).pathname === pathname);
    const failOnce = pageFor('/retry/fail-once');
    const rateLimited = pageFor('/retry/rate-limited');
    const permanent = pageFor('/retry/permanent');

    expect(failOnce).toMatchObject({
      status: 'captured',
      httpStatus: 200,
      attempts: [
        { attempt: 1, outcome: 'retrying', httpStatus: 503, retryDelayMs: 250 },
        { attempt: 2, outcome: 'captured', httpStatus: 200 },
      ],
    });
    expect(rateLimited).toMatchObject({
      status: 'captured',
      httpStatus: 200,
      attempts: [
        { attempt: 1, outcome: 'retrying', httpStatus: 429, retryDelayMs: 1_000 },
        { attempt: 2, outcome: 'captured', httpStatus: 200 },
      ],
    });
    expect(permanent).toMatchObject({
      status: 'failed',
      httpStatus: 503,
      files: null,
      attempts: [
        { attempt: 1, outcome: 'retrying', httpStatus: 503, retryDelayMs: 250 },
        { attempt: 2, outcome: 'retrying', httpStatus: 503, retryDelayMs: 500 },
        { attempt: 3, outcome: 'failed', httpStatus: 503 },
      ],
      errors: [{ code: 'HTTP_RETRYABLE_STATUS', retryable: true }],
    });
    expect(result.manifest.pages).toHaveLength(4);
    expect(result.summary.counts.pages).toBe(3);

    const failOnceHtml = await readFile(
      path.join(result.outputDirectory, failOnce?.files?.renderedHtml ?? ''),
      'utf8',
    );
    const rateLimitedHtml = await readFile(
      path.join(result.outputDirectory, rateLimited?.files?.renderedHtml ?? ''),
      'utf8',
    );
    expect(failOnceHtml).toContain('Recovered after one retry');
    expect(rateLimitedHtml).toContain('Recovered after Retry-After');
  }, 30_000);

  it('records non-retryable client responses as failures instead of design evidence', async () => {
    const outputRoot = path.join(os.tmpdir(), `sitepull-http-client-${crypto.randomUUID()}`);
    roots.push(outputRoot);
    await mkdir(outputRoot);
    const result = await runCapture(
      {
        url: `${fixtureUrl}/client-error-suite`,
        outputDirectory: outputRoot,
        config: {
          maxDepth: 1,
          maxPages: 8,
          crawlConcurrency: 3,
          maxElementsPerPage: 100,
          pageTimeoutMs: 10_000,
          viewports: [{ name: 'desktop', width: 800, height: 600 }],
        },
      },
      { allowPrivateHosts: true },
    );

    const suite = result.manifest.pages.find(
      (page) => new URL(page.url).pathname === '/client-error-suite',
    );
    expect(suite).toMatchObject({
      status: 'captured',
      httpStatus: 200,
      metrics: { elementsTruncated: true, inaccessibleStylesheets: 0 },
    });

    for (const status of [400, 401, 403, 404, 405, 410, 451]) {
      const page = result.manifest.pages.find(
        (candidate) => new URL(candidate.url).pathname === `/client-errors/${status}`,
      );
      expect(page).toMatchObject({
        status: 'failed',
        httpStatus: status,
        files: null,
        metrics: { elementsTruncated: false, inaccessibleStylesheets: 0 },
        attempts: [{ attempt: 1, outcome: 'failed', httpStatus: status }],
        errors: [
          {
            code: status === 403 ? 'HTTP_FORBIDDEN' : 'HTTP_CLIENT_ERROR',
            retryable: false,
            details: { status },
          },
        ],
      });
      await expect(
        readdir(path.join(result.outputDirectory, 'pages', page?.id ?? 'missing', 'screenshots')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    }
    expect(result.manifest.pages).toHaveLength(8);
    expect(result.summary.counts.pages).toBe(1);
  }, 30_000);

  it('bounds unknown response bodies and the aggregate capture resource budget', async () => {
    const unknownOutputRoot = path.join(
      os.tmpdir(),
      `sitepull-resource-unknown-${crypto.randomUUID()}`,
    );
    roots.push(unknownOutputRoot);
    await mkdir(unknownOutputRoot);
    const unknownResult = await runCapture(
      {
        url: `${fixtureUrl}/resource-budget/unknown`,
        outputDirectory: unknownOutputRoot,
        config: {
          maxDepth: 0,
          maxPages: 1,
          maxResourceBytes: 512,
          maxCaptureResourceBytes: 8_192,
          resourceBodyConcurrency: 1,
          pageTimeoutMs: 8_000,
          viewports: [{ name: 'desktop', width: 800, height: 600 }],
        },
      },
      { allowPrivateHosts: true },
    );
    const unknownResource = unknownResult.manifest.resources.find(
      (resource) => new URL(resource.originalUrl).pathname === '/resource-budget/unknown.css',
    );
    expect(unknownResource).toMatchObject({
      captured: false,
      localPath: null,
      sha256: null,
      failureReason: expect.stringContaining('512 bytes'),
    });
    const unknownSourceMap = unknownResult.manifest.resources.find(
      (resource) => new URL(resource.originalUrl).pathname === '/resource-budget/unknown.js.map',
    );
    expect(unknownSourceMap).toMatchObject({
      kind: 'source-map',
      captured: false,
      localPath: null,
      sha256: null,
      failureReason: expect.stringContaining('512-byte'),
    });
    expect(unknownResult.manifest.config).toMatchObject({
      maxResourceBytes: 512,
      maxCaptureResourceBytes: 8_192,
      resourceBodyConcurrency: 1,
    });

    const exhaustedUrl = `${fixtureUrl}/resource-budget/source-map-exhausted`;
    const [exhaustedDocumentResponse, sourceMapScriptResponse] = await Promise.all([
      fetch(exhaustedUrl),
      fetch(`${fixtureUrl}/resource-budget/source-map.js`),
    ]);
    const [exhaustedDocumentBody, sourceMapScriptBody] = await Promise.all([
      exhaustedDocumentResponse.arrayBuffer(),
      sourceMapScriptResponse.arrayBuffer(),
    ]);
    const exhaustedLimit = exhaustedDocumentBody.byteLength + sourceMapScriptBody.byteLength;
    const exhaustedOutputRoot = path.join(
      os.tmpdir(),
      `sitepull-resource-exhausted-${crypto.randomUUID()}`,
    );
    roots.push(exhaustedOutputRoot);
    await mkdir(exhaustedOutputRoot);
    const exhaustedResult = await runCapture(
      {
        url: exhaustedUrl,
        outputDirectory: exhaustedOutputRoot,
        config: {
          maxDepth: 0,
          maxPages: 1,
          maxResourceBytes: 4_096,
          maxCaptureResourceBytes: exhaustedLimit,
          resourceBodyConcurrency: 1,
          pageTimeoutMs: 8_000,
          viewports: [{ name: 'desktop', width: 800, height: 600 }],
        },
      },
      { allowPrivateHosts: true },
    );
    expect(
      exhaustedResult.manifest.resources.find(
        (resource) => new URL(resource.originalUrl).pathname === '/resource-budget/unknown.js.map',
      ),
    ).toMatchObject({
      kind: 'source-map',
      httpStatus: 0,
      captured: false,
      failureReason: expect.stringContaining('budget'),
    });

    const aggregateUrl = `${fixtureUrl}/resource-budget/aggregate`;
    const [documentResponse, assetResponse] = await Promise.all([
      fetch(aggregateUrl),
      fetch(`${fixtureUrl}/resource-budget/aggregate-a.css`),
    ]);
    const [documentBody, assetBody] = await Promise.all([
      documentResponse.arrayBuffer(),
      assetResponse.arrayBuffer(),
    ]);
    const aggregateLimit = documentBody.byteLength + assetBody.byteLength;
    const aggregateOutputRoot = path.join(
      os.tmpdir(),
      `sitepull-resource-aggregate-${crypto.randomUUID()}`,
    );
    roots.push(aggregateOutputRoot);
    await mkdir(aggregateOutputRoot);
    const aggregateResult = await runCapture(
      {
        url: aggregateUrl,
        outputDirectory: aggregateOutputRoot,
        config: {
          maxDepth: 0,
          maxPages: 1,
          maxResourceBytes: 4_096,
          maxCaptureResourceBytes: aggregateLimit,
          resourceBodyConcurrency: 1,
          pageTimeoutMs: 8_000,
          viewports: [{ name: 'desktop', width: 800, height: 600 }],
        },
      },
      { allowPrivateHosts: true },
    );
    const aggregateResources = aggregateResult.manifest.resources.filter((resource) =>
      /^\/resource-budget\/aggregate-[ab]\.css$/u.test(new URL(resource.originalUrl).pathname),
    );
    expect(aggregateResources).toHaveLength(2);
    expect(aggregateResources.filter((resource) => resource.captured)).toHaveLength(1);
    expect(aggregateResources.filter((resource) => !resource.captured)).toEqual([
      expect.objectContaining({
        localPath: null,
        sha256: null,
        failureReason: expect.stringContaining('Capture resource budget'),
      }),
    ]);
    expect(aggregateResult.manifest.config.maxCaptureResourceBytes).toBe(aggregateLimit);
    expect(aggregateResult.manifest.pages[0]?.metrics.capturedResources).toBe(2);
  }, 45_000);

  it('cancels a live browser job and removes only its staging directory', async () => {
    const outputRoot = path.join(os.tmpdir(), `sitepull-cancel-${crypto.randomUUID()}`);
    roots.push(outputRoot);
    await mkdir(outputRoot);
    const controller = new AbortController();
    const pending = runCapture(
      {
        url: fixtureUrl,
        outputDirectory: outputRoot,
        config: { maxPages: 4, pageTimeoutMs: 15_000 },
      },
      { allowPrivateHosts: true, signal: controller.signal },
    );
    setTimeout(() => controller.abort('integration cancellation'), 250);
    await expect(pending).rejects.toMatchObject({ code: 'CAPTURE_CANCELLED' });
    expect((await readdir(outputRoot)).filter((name) => name.endsWith('.partial'))).toEqual([]);
  }, 30_000);
});
