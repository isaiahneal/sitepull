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
