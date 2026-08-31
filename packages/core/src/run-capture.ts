import { constants } from 'node:fs';
import { access, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  AssetManifestSchema,
  CaptureEventSchema,
  CaptureManifestSchema,
  CrawlConfigSchema,
  ElementsManifestSchema,
  LinksManifestSchema,
  NetworkManifestSchema,
  PageManifestSchema,
  SITEPULL_VERSION,
  SitepullMetadataSchema,
  type CaptureEvent,
  type CaptureManifest,
  type CaptureResultSummary,
  type CaptureStage,
  type CrawlConfigInput,
  type JsonValue,
  type PageLink,
  type PageManifest,
  type ResourceKind as ContractResourceKind,
  type SkippedUrl,
} from '@sitepull/contracts';
import type { Browser, BrowserContext, BrowserType } from 'playwright';

import { generateAiContext, generatedCaptureReadme } from './ai-context.js';
import { analyzeSiteDesign, designSystemMarkdown, type AnalyzablePage } from './analyze.js';
import { mapWithConcurrency, throwIfAborted } from './async.js';
import {
  installUntrustedPageNetworkGuards,
  untrustedBrowserLaunchOptions,
} from './browser-network-policy.js';
import { capturePage, type CapturedResourcePayload } from './capture-page.js';
import { asSitepullError, SitepullError } from './errors.js';
import { selectExportFiles } from './export.js';
import { createJsonLinesLogger, type SitepullLogger } from './logger.js';
import { createNetworkPolicyProxy, type NetworkPolicyProxy } from './network-proxy.js';
import {
  assertNetworkUrlAllowed,
  cancelResponseBody,
  fetchValidatedResource,
  readBoundedResponseBody,
} from './network-policy.js';
import { captureWithPageRetries } from './page-retry.js';
import { ProjectWriter } from './project.js';
import { ResourceCaptureBudget } from './resource-budget.js';
import { ResourceStore } from './resource-store.js';
import { classifyResource, type ResourceKind } from './resources.js';
import {
  canonicalizeUrl,
  evaluateDiscoveredUrl,
  isAllowedByOrigin,
  type UrlSkipReason,
} from './url.js';
import { routeSlug } from './paths.js';

export interface RunCaptureInput {
  readonly url: string;
  readonly outputDirectory: string;
  readonly config?: CrawlConfigInput;
  /** Permit HTTPS-to-HTTP fallback only when the caller inferred the scheme. */
  readonly allowHttpFallback?: boolean;
}

export interface RunCaptureOptions {
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: CaptureEvent) => void;
  /** Intended for deterministic loopback fixtures; desktop and CLI leave this false. */
  readonly allowPrivateHosts?: boolean;
  /** Use a distro-managed Chromium build instead of Playwright's bundled binary. */
  readonly chromiumExecutablePath?: string;
}

export interface CaptureRunResult {
  readonly outputDirectory: string;
  readonly summary: CaptureResultSummary;
  readonly manifest: CaptureManifest;
}

interface QueueEntry {
  readonly url: string;
  readonly depth: number;
}

const INTERNAL_TO_CONTRACT_KIND: Readonly<Record<ResourceKind, ContractResourceKind>> = {
  html: 'html',
  css: 'css',
  javascript: 'javascript',
  image: 'image',
  svg: 'svg',
  font: 'font',
  json: 'json',
  manifest: 'manifest',
  icon: 'icon',
  media: 'other',
  document: 'other',
  other: 'other',
};

async function browserType(engine: 'webkit' | 'chromium' | 'firefox'): Promise<BrowserType> {
  const { webkit, chromium, firefox } = await import('playwright');
  return engine === 'webkit' ? webkit : engine === 'chromium' ? chromium : firefox;
}

function routePath(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function jsonContext(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, JsonValue>> {
  return JSON.parse(JSON.stringify(value)) as Readonly<Record<string, JsonValue>>;
}

function httpUrlOrNull(value: string | null): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function mapSkipReason(reason: UrlSkipReason): SkippedUrl['reason'] {
  if (reason === 'query-variant-limit') return 'query-variant-limit';
  if (reason === 'url-limit') return 'page-limit';
  return reason;
}

function serializeError(error: SitepullError): ReturnType<SitepullError['toJSON']> {
  return error.toJSON();
}

async function launchBrowser(
  engine: 'webkit' | 'chromium' | 'firefox',
  headed: boolean,
  chromiumExecutablePath?: string,
): Promise<Browser> {
  let executablePath: string | undefined;
  if (chromiumExecutablePath !== undefined) {
    if (engine !== 'chromium') {
      throw new SitepullError({
        code: 'BROWSER_NOT_INSTALLED',
        message: 'A system Chromium executable can only be used with the chromium engine.',
        stage: 'launching-browser',
      });
    }
    if (!path.isAbsolute(chromiumExecutablePath)) {
      throw new SitepullError({
        code: 'BROWSER_NOT_INSTALLED',
        message: 'The configured system Chromium path must be absolute.',
        stage: 'launching-browser',
      });
    }
    try {
      executablePath = await realpath(chromiumExecutablePath);
      const executableStats = await stat(executablePath);
      if (!executableStats.isFile()) throw new Error('not a regular file');
      await access(executablePath, constants.X_OK);
    } catch (error) {
      throw new SitepullError({
        code: 'BROWSER_NOT_INSTALLED',
        message: `System Chromium is not an executable file: ${chromiumExecutablePath}`,
        stage: 'launching-browser',
        retryable: false,
        cause: error,
      });
    }
  }

  try {
    return await (
      await browserType(engine)
    ).launch({
      ...untrustedBrowserLaunchOptions(engine, headed, {
        systemChromium: executablePath !== undefined,
      }),
      ...(executablePath === undefined ? {} : { executablePath }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      executablePath === undefined &&
      /executable.*doesn.*exist|browser.*not.*installed|playwright install/iu.test(message)
    ) {
      throw new SitepullError({
        code: 'BROWSER_NOT_INSTALLED',
        message: `Playwright ${engine} is not installed. Run: pnpm exec playwright install ${engine}`,
        stage: 'launching-browser',
        retryable: true,
        cause: error,
      });
    }
    throw new SitepullError({
      code: 'CRAWL_FAILED',
      message:
        executablePath === undefined
          ? `Could not launch Playwright ${engine}: ${message}`
          : `Could not launch system Chromium at ${executablePath}: ${message}`,
      stage: 'launching-browser',
      retryable: true,
      cause: error,
    });
  }
}

async function createContexts(options: {
  browser: Browser;
  count: number;
  sourceUrl: string;
  sameOriginOnly: boolean;
  includeSubdomains: boolean;
  pageTimeoutMs: number;
  proxyServer: string;
  engine: 'webkit' | 'chromium' | 'firefox';
}): Promise<BrowserContext[]> {
  return Promise.all(
    Array.from({ length: options.count }, async () => {
      const context = await options.browser.newContext({
        acceptDownloads: false,
        ignoreHTTPSErrors: false,
        serviceWorkers: 'block',
        proxy: { server: options.proxyServer },
      });
      await installUntrustedPageNetworkGuards(context, options.engine);
      context.setDefaultTimeout(options.pageTimeoutMs);
      await context.route('**/*', async (route) => {
        const request = route.request();
        try {
          if (
            options.sameOriginOnly &&
            request.isNavigationRequest() &&
            request.frame().parentFrame() === null &&
            !isAllowedByOrigin(request.url(), {
              originUrl: options.sourceUrl,
              includeSubdomains: options.includeSubdomains,
            })
          ) {
            await route.abort('blockedbyclient');
            return;
          }
          await route.continue();
        } catch {
          await route.abort('blockedbyclient');
        }
      });
      return context;
    }),
  );
}

function isHttpFallbackCandidate(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/blockedbyclient|ERR_BLOCKED_BY_CLIENT|PRIVATE_NETWORK_BLOCKED/iu.test(message)) return false;
  return /certificate|connection|ERR_CERT|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_SSL|ENOTFOUND|SSL|timeout|TLS/iu.test(
    message,
  );
}

async function resolveInferredStartUrl(options: {
  browser: Browser;
  httpsUrl: string;
  includeSubdomains: boolean;
  allowPrivateHosts: boolean;
  pageTimeoutMs: number;
  proxyServer: string;
  engine: 'webkit' | 'chromium' | 'firefox';
  signal?: AbortSignal;
  onFallback: (error: unknown, httpUrl: string) => Promise<void>;
}): Promise<string> {
  const candidates = [
    options.httpsUrl,
    canonicalizeUrl(new URL(options.httpsUrl).href.replace(/^https:/u, 'http:')),
  ];
  let httpsError: unknown;

  for (const [index, candidate] of candidates.entries()) {
    throwIfAborted(options.signal);
    await assertNetworkUrlAllowed(candidate, options.allowPrivateHosts);
    if (index === 1) await options.onFallback(httpsError, candidate);
    const [context] = await createContexts({
      browser: options.browser,
      count: 1,
      sourceUrl: candidate,
      sameOriginOnly: false,
      includeSubdomains: options.includeSubdomains,
      pageTimeoutMs: options.pageTimeoutMs,
      proxyServer: options.proxyServer,
      engine: options.engine,
    });
    if (context === undefined) {
      throw new SitepullError({
        code: 'INTERNAL_ERROR',
        message: 'Browser context pool was unavailable while resolving the start URL.',
      });
    }
    const page = await context.newPage();
    try {
      await page.goto(candidate, {
        waitUntil: 'commit',
        timeout: options.pageTimeoutMs,
      });
      return canonicalizeUrl(page.url());
    } catch (error) {
      if (index === 0 && isHttpFallbackCandidate(error)) {
        httpsError = error;
        continue;
      }
      throw error;
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  throw httpsError;
}

export async function runCapture(
  input: RunCaptureInput,
  options: RunCaptureOptions = {},
): Promise<CaptureRunResult> {
  const startedAt = new Date();
  let sequence = 0;
  let writer: ProjectWriter | undefined;
  let logger: SitepullLogger | undefined;
  let browser: Browser | undefined;
  let networkProxy: NetworkPolicyProxy | undefined;
  let contexts: BrowserContext[] = [];
  let completedPages = 0;
  let elementCount = 0;
  let discoveredPages = 0;
  let resourceStore: ResourceStore | undefined;

  const counters = () => ({
    discoveredPages,
    completedPages,
    assets: resourceStore?.count ?? 0,
    elements: elementCount,
    bytesCaptured: resourceStore?.totalUniqueBytes ?? 0,
  });
  const emit = (event: CaptureEvent): void => {
    try {
      options.onEvent?.(CaptureEventSchema.parse(event));
    } catch {
      // A UI/progress subscriber cannot invalidate a capture job.
    }
  };
  const emitProgress = (
    stage: CaptureStage,
    state: 'started' | 'progress' | 'completed',
    message: string,
    currentUrl: string | null = null,
    determinate: { completed: number; total: number } | null = null,
  ): void => {
    if (writer === undefined) return;
    emit({
      type: 'progress',
      captureId: writer.captureId,
      sequence: sequence++,
      timestamp: new Date().toISOString(),
      stage,
      state,
      message,
      currentUrl,
      elapsedMs: Date.now() - startedAt.getTime(),
      counters: counters(),
      determinate,
    });
  };
  const log = async (
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    stage: CaptureStage | null,
    context?: Readonly<Record<string, unknown>>,
  ): Promise<void> => {
    const safeContext = context === undefined ? undefined : jsonContext(context);
    await logger?.log({
      level,
      stage,
      message,
      ...(safeContext === undefined ? {} : { context: safeContext }),
    });
    if (writer !== undefined) {
      emit({
        type: 'log',
        captureId: writer.captureId,
        sequence: sequence++,
        timestamp: new Date().toISOString(),
        level,
        stage,
        message,
        ...(safeContext === undefined ? {} : { context: safeContext }),
      });
    }
  };

  try {
    throwIfAborted(options.signal);
    let normalizedUrl = canonicalizeUrl(input.url);
    const config = CrawlConfigSchema.parse(input.config ?? {});
    const resourceBudget = new ResourceCaptureBudget({
      maxResourceBytes: config.maxResourceBytes,
      maxCaptureBytes: config.maxCaptureResourceBytes,
      bodyConcurrency: config.resourceBodyConcurrency,
    });
    const allowPrivateHosts = options.allowPrivateHosts ?? false;
    await assertNetworkUrlAllowed(normalizedUrl, allowPrivateHosts);
    writer = await ProjectWriter.create(input.outputDirectory, normalizedUrl, startedAt);
    logger = await createJsonLinesLogger(writer.resolve('logs/sitepull.jsonl'));
    resourceStore = new ResourceStore(writer);
    emitProgress(
      'normalizing-url',
      'completed',
      'URL normalized and output path validated.',
      normalizedUrl,
    );
    await log('info', 'Capture started.', 'normalizing-url', {
      url: normalizedUrl,
      engine: config.engine,
      maxResourceBytes: config.maxResourceBytes,
      maxCaptureResourceBytes: config.maxCaptureResourceBytes,
      resourceBodyConcurrency: config.resourceBodyConcurrency,
    });

    emitProgress('launching-browser', 'started', `Launching ${config.engine}.`, normalizedUrl);
    browser = await launchBrowser(config.engine, config.headed, options.chromiumExecutablePath);
    networkProxy = await createNetworkPolicyProxy({
      allowPrivateHosts,
      connectTimeoutMs: config.pageTimeoutMs,
    });
    if (input.allowHttpFallback === true && new URL(normalizedUrl).protocol === 'https:') {
      normalizedUrl = await resolveInferredStartUrl({
        browser,
        httpsUrl: normalizedUrl,
        includeSubdomains: config.includeSubdomains,
        allowPrivateHosts,
        pageTimeoutMs: config.pageTimeoutMs,
        proxyServer: networkProxy.serverUrl,
        engine: config.engine,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        onFallback: async (error, httpUrl) => {
          emitProgress(
            'launching-browser',
            'progress',
            'HTTPS was unavailable; retrying this inferred address over HTTP.',
            httpUrl,
          );
          await log(
            'warn',
            'HTTPS was unavailable; retrying the inferred address over HTTP.',
            'launching-browser',
            {
              httpsUrl: canonicalizeUrl(input.url),
              httpUrl,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        },
      });
    }
    contexts = await createContexts({
      browser,
      count: config.crawlConcurrency,
      sourceUrl: normalizedUrl,
      sameOriginOnly: config.sameOriginOnly,
      includeSubdomains: config.includeSubdomains,
      pageTimeoutMs: config.pageTimeoutMs,
      proxyServer: networkProxy.serverUrl,
      engine: config.engine,
    });
    emitProgress('launching-browser', 'completed', `${config.engine} launched.`, normalizedUrl);

    const seen = new Set<string>([normalizedUrl]);
    const queryVariants = new Map<string, Set<string>>();
    const queue: QueueEntry[] = [{ url: normalizedUrl, depth: 0 }];
    discoveredPages = 1;
    const skippedUrls: SkippedUrl[] = [];
    const pageManifests: PageManifest[] = [];
    const analyzablePages: AnalyzablePage[] = [];
    const explicitSourceMaps = new Set<string>();
    let crawlStarted = false;
    let lastPageFailure: SitepullError | undefined;

    const considerLink = (
      href: string,
      sourceUrl: string,
    ): ReturnType<typeof evaluateDiscoveredUrl> => {
      let candidatePolicyUrl = normalizedUrl;
      if (!config.sameOriginOnly) {
        try {
          candidatePolicyUrl = new URL(href, sourceUrl).origin;
        } catch {
          // evaluateDiscoveredUrl will provide the structured invalid decision.
        }
      }
      const decision = evaluateDiscoveredUrl(href, sourceUrl, {
        originUrl: candidatePolicyUrl,
        includeSubdomains: config.sameOriginOnly ? config.includeSubdomains : true,
      });
      if (!decision.accepted) return decision;
      if (seen.has(decision.url)) return { accepted: false, href, reason: 'duplicate' };
      if (seen.size >= config.maxPages) return { accepted: false, href, reason: 'url-limit' };
      const parsed = new URL(decision.url);
      if (parsed.search !== '') {
        const key = `${parsed.origin}${parsed.pathname}`;
        const variants = queryVariants.get(key) ?? new Set<string>();
        if (!variants.has(parsed.search) && variants.size >= 3) {
          return { accepted: false, href, reason: 'query-variant-limit' };
        }
        variants.add(parsed.search);
        queryVariants.set(key, variants);
      }
      seen.add(decision.url);
      return decision;
    };

    const recordResource = async (
      payload: CapturedResourcePayload,
      context: BrowserContext,
    ): Promise<void> => {
      const stored = await resourceStore?.record(payload);
      const sourceMapUrl = stored?.sourceMapUrl ?? null;
      if (sourceMapUrl === null || explicitSourceMaps.has(sourceMapUrl)) return;
      explicitSourceMaps.add(sourceMapUrl);
      let response: Response | undefined;
      let finalUrl: string | undefined;
      let responseHeaders: Readonly<Record<string, string>> | undefined;
      let responseStatus: number | undefined;
      let contentType: string | null = null;
      try {
        const bodyResult = await resourceBudget.read({
          declaredBytes: null,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          read: async (maxBytes) => {
            const opened = await fetchValidatedResource(sourceMapUrl, {
              allowPrivateHosts,
              timeoutMs: config.pageTimeoutMs,
              ...(options.signal === undefined ? {} : { signal: options.signal }),
              headersForUrl: async (url) => {
                const cookies = await context.cookies(url);
                const cookie = cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
                return cookie === '' ? {} : { cookie };
              },
            });
            response = opened.response;
            finalUrl = opened.finalUrl;
            responseHeaders = Object.fromEntries(response.headers.entries());
            responseStatus = response.status;
            contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? null;
            const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10);
            if (Number.isSafeInteger(declared) && declared > maxBytes) {
              throw new SitepullError({
                code: 'RESOURCE_TOO_LARGE',
                message: `Source map response exceeds the ${maxBytes}-byte materialization limit.`,
                stage: 'capturing-assets',
                details: { url: finalUrl, declaredBytes: declared, maxBytes },
              });
            }
            return readBoundedResponseBody(response, maxBytes, options.signal);
          },
        });
        if (
          finalUrl === undefined ||
          responseHeaders === undefined ||
          responseStatus === undefined
        ) {
          throw new SitepullError({
            code: 'RESOURCE_TOO_LARGE',
            message: bodyResult.failureReason ?? 'The source map resource budget is exhausted.',
            stage: 'capturing-assets',
            details: { url: sourceMapUrl },
          });
        }
        await resourceStore?.record({
          originalUrl: sourceMapUrl,
          finalUrl,
          status: responseStatus,
          contentType,
          headers: responseHeaders,
          body: bodyResult.body,
          referencedByPage: payload.referencedByPage,
          ...(bodyResult.failureReason === undefined
            ? {}
            : { failureReason: bodyResult.failureReason }),
        });
      } catch (error) {
        if (error instanceof SitepullError && error.code === 'CAPTURE_CANCELLED') throw error;
        const failureReason = (error instanceof Error ? error.message : String(error)).slice(
          0,
          10_000,
        );
        await resourceStore?.record({
          originalUrl: sourceMapUrl,
          finalUrl: finalUrl ?? sourceMapUrl,
          status: responseStatus ?? 0,
          contentType,
          headers: responseHeaders ?? {},
          body: null,
          referencedByPage: payload.referencedByPage,
          failureReason: failureReason === '' ? 'The source map was unavailable.' : failureReason,
        });
        await log(
          'warn',
          'An explicitly referenced source map could not be captured.',
          'capturing-assets',
          {
            sourceMapUrl,
            error: failureReason,
          },
        );
      } finally {
        if (response !== undefined) await cancelResponseBody(response);
      }
    };

    emitProgress('rendering', 'started', 'Rendering the first route.', normalizedUrl);
    while (queue.length > 0) {
      throwIfAborted(options.signal);
      const batch = queue.splice(0, config.crawlConcurrency);
      const capturedBatch = await mapWithConcurrency(
        batch,
        config.crawlConcurrency,
        async (entry, index) => {
          const context = contexts[index];
          if (context === undefined) {
            throw new SitepullError({
              code: 'INTERNAL_ERROR',
              message: 'Browser context pool was unavailable.',
            });
          }
          const id = routeSlug(entry.url);
          const screenshotsRelative = `pages/${id}/screenshots`;
          const activeWriter = writer;
          if (activeWriter === undefined) {
            throw new SitepullError({
              code: 'INTERNAL_ERROR',
              message: 'Capture project writer was unavailable.',
            });
          }
          const screenshotsDirectory = await activeWriter.ensureDirectory(screenshotsRelative);
          const result = await captureWithPageRetries(
            async (attempt) => {
              const attemptBudget = resourceBudget.createScope();
              try {
                if (attempt > 1) {
                  await rm(screenshotsDirectory, { recursive: true, force: true });
                  await activeWriter.ensureDirectory(screenshotsRelative);
                }
                const captured = await capturePage({
                  context,
                  url: entry.url,
                  route: routePath(entry.url),
                  viewports: config.viewports,
                  pageTimeoutMs: config.pageTimeoutMs,
                  maxElements: config.maxElementsPerPage,
                  screenshotsDirectory,
                  screenshotRelativeDirectory: screenshotsRelative,
                  resourceBudget: attemptBudget,
                  ...(options.signal === undefined ? {} : { signal: options.signal }),
                });
                attemptBudget.commit();
                return captured;
              } catch (error) {
                attemptBudget.rollback();
                throw error;
              }
            },
            {
              ...(options.signal === undefined ? {} : { signal: options.signal }),
              getHttpStatus: (data) => data.status,
              onRetry: async (attempt) => {
                const delay = attempt.retryDelayMs ?? 0;
                const retryStage = crawlStarted ? 'crawling-pages' : 'rendering';
                emitProgress(
                  retryStage,
                  'progress',
                  `Retrying ${entry.url} after attempt ${attempt.attempt} in ${delay} ms.`,
                  entry.url,
                );
                await log('warn', 'Page capture attempt will be retried.', retryStage, {
                  url: entry.url,
                  attempt: attempt.attempt,
                  httpStatus: attempt.httpStatus,
                  retryDelayMs: delay,
                  error: attempt.error ?? null,
                });
              },
            },
          );
          if (result.ok) {
            await Promise.all(
              result.value.resources.map(async (payload) => recordResource(payload, context)),
            );
          } else {
            await rm(screenshotsDirectory, { recursive: true, force: true });
          }
          return result.ok
            ? { queue: entry, ok: true as const, data: result.value, attempts: result.attempts }
            : { queue: entry, ok: false as const, error: result.error, attempts: result.attempts };
        },
      );

      for (const captured of capturedBatch) {
        throwIfAborted(options.signal);
        const id = routeSlug(captured.queue.url);
        const pageRoute = routePath(captured.queue.url);
        if (!captured.ok) {
          if (captured.error.code === 'CAPTURE_CANCELLED') throw captured.error;
          lastPageFailure = captured.error;
          await log('error', captured.error.message, 'crawling-pages', {
            url: captured.queue.url,
            attempts: captured.attempts.length,
            httpStatus: captured.attempts.at(-1)?.httpStatus ?? null,
            attemptEvidence: captured.attempts,
          });
          pageManifests.push(
            PageManifestSchema.parse({
              id,
              route: pageRoute,
              url: captured.queue.url,
              canonicalUrl: captured.queue.url,
              title: '',
              contentType: null,
              httpStatus: captured.attempts.at(-1)?.httpStatus ?? null,
              depth: captured.queue.depth,
              status: 'failed',
              capturedAt: new Date().toISOString(),
              files: null,
              screenshots: [],
              metrics: {
                visibleElements: 0,
                elementsTruncated: false,
                inaccessibleStylesheets: 0,
                discoveredLinks: 0,
                networkRequests: 0,
                capturedResources: 0,
                byteSize: 0,
                durationMs: captured.attempts.reduce(
                  (total, attempt) => total + attempt.durationMs + (attempt.retryDelayMs ?? 0),
                  0,
                ),
              },
              attempts: captured.attempts,
              errors: [serializeError(captured.error)],
            }),
          );
          completedPages += 1;
          continue;
        }

        if (!crawlStarted) {
          emitProgress(
            'rendering',
            'completed',
            'The first route rendered and stabilized.',
            captured.data.finalUrl,
          );
          emitProgress(
            'discovering-routes',
            'started',
            'Discovering links from rendered pages.',
            captured.data.finalUrl,
          );
          emitProgress(
            'crawling-pages',
            'started',
            'Crawling the bounded route queue.',
            captured.data.finalUrl,
          );
          crawlStarted = true;
        }

        const linkRecords: PageLink[] = [];
        const pageSkipped: SkippedUrl[] = [];
        for (const link of captured.data.links) {
          const resolvedUrl = httpUrlOrNull(link.resolvedUrl);
          if (link.href.startsWith('#')) {
            const skipped: SkippedUrl = {
              url: link.href,
              discoveredOn: captured.data.finalUrl,
              reason: 'fragment-only',
            };
            pageSkipped.push(skipped);
            linkRecords.push({
              href: link.href,
              text: link.text,
              resolvedUrl,
              canonicalUrl: null,
              disposition: 'skipped',
              skipReason: 'fragment-only',
            });
            continue;
          }
          if (captured.queue.depth >= config.maxDepth) {
            const preliminary = evaluateDiscoveredUrl(link.href, captured.data.finalUrl, {
              originUrl: normalizedUrl,
              includeSubdomains: config.includeSubdomains,
            });
            if (preliminary.accepted) {
              pageSkipped.push({
                url: preliminary.url,
                discoveredOn: captured.data.finalUrl,
                reason: 'depth-limit',
              });
              linkRecords.push({
                href: link.href,
                text: link.text,
                resolvedUrl,
                canonicalUrl: preliminary.url,
                disposition: 'skipped',
                skipReason: 'depth-limit',
              });
              continue;
            }
          }
          const decision = considerLink(link.href, captured.data.finalUrl);
          if (decision.accepted) {
            queue.push({ url: decision.url, depth: captured.queue.depth + 1 });
            discoveredPages += 1;
            linkRecords.push({
              href: link.href,
              text: link.text,
              resolvedUrl,
              canonicalUrl: decision.url,
              disposition: 'enqueued',
            });
          } else if (decision.reason === 'duplicate') {
            linkRecords.push({
              href: link.href,
              text: link.text,
              resolvedUrl,
              canonicalUrl: resolvedUrl === null ? null : canonicalizeUrl(resolvedUrl),
              disposition: 'visited',
            });
          } else if (decision.reason === 'external-origin') {
            const skipped: SkippedUrl = {
              url: resolvedUrl ?? link.href,
              discoveredOn: captured.data.finalUrl,
              reason: 'external-origin',
            };
            pageSkipped.push(skipped);
            linkRecords.push({
              href: link.href,
              text: link.text,
              resolvedUrl,
              canonicalUrl: null,
              disposition: 'external',
            });
          } else {
            const reason = mapSkipReason(decision.reason);
            const skipped: SkippedUrl = {
              url: resolvedUrl ?? link.href,
              discoveredOn: captured.data.finalUrl,
              reason,
            };
            pageSkipped.push(skipped);
            linkRecords.push({
              href: link.href,
              text: link.text,
              resolvedUrl,
              canonicalUrl: null,
              disposition: 'skipped',
              skipReason: reason,
            });
          }
        }
        skippedUrls.push(...pageSkipped);

        const canonicalFinal = canonicalizeUrl(captured.data.finalUrl);
        const documentData = {
          ...captured.data.document,
          canonicalUrl: canonicalFinal,
          url: captured.data.finalUrl,
        };
        const elementsData = ElementsManifestSchema.parse({
          schemaVersion: 1,
          pageUrl: captured.data.finalUrl,
          capturedAt: new Date().toISOString(),
          elementCount: captured.data.elements.length,
          truncated: captured.data.elementsTruncated,
          maxElements: config.maxElementsPerPage,
          elements: captured.data.elements,
        });
        const linksData = LinksManifestSchema.parse({
          schemaVersion: 1,
          pageUrl: captured.data.finalUrl,
          links: linkRecords,
          skipped: pageSkipped,
        });
        const networkEntries = captured.data.network
          .filter((entry) => httpUrlOrNull(entry.url) !== null)
          .map((entry) => ({
            ...entry,
            kind: /\.map(?:$|[?#])/iu.test(entry.url)
              ? ('source-map' as const)
              : INTERNAL_TO_CONTRACT_KIND[
                  classifyResource({ url: entry.url, contentType: entry.contentType })
                ],
          }));
        const networkData = NetworkManifestSchema.parse({
          schemaVersion: 1,
          pageUrl: captured.data.finalUrl,
          entries: networkEntries,
        });
        const pageBase = `pages/${id}`;
        const files = {
          renderedHtml: `${pageBase}/rendered.html`,
          document: `${pageBase}/document.json`,
          elements: `${pageBase}/elements.json`,
          links: `${pageBase}/links.json`,
          network: `${pageBase}/network.json`,
        };
        await Promise.all([
          writer.writeText(files.renderedHtml, captured.data.renderedHtml),
          writer.writeJson(files.document, documentData),
          writer.writeJson(files.elements, elementsData),
          writer.writeJson(files.links, linksData),
          writer.writeJson(files.network, networkData),
        ]);
        const screenshotBytes = captured.data.screenshots.reduce(
          (sum, screenshot) =>
            sum + (screenshot.viewportByteSize ?? 0) + (screenshot.fullPageByteSize ?? 0),
          0,
        );
        const pageManifest = PageManifestSchema.parse({
          id,
          route: pageRoute,
          url: captured.data.finalUrl,
          canonicalUrl: canonicalFinal,
          title: captured.data.title,
          contentType: captured.data.contentType,
          httpStatus: captured.data.status,
          depth: captured.queue.depth,
          status: 'captured',
          capturedAt: new Date().toISOString(),
          files,
          screenshots: captured.data.screenshots,
          metrics: {
            visibleElements: captured.data.elements.length,
            elementsTruncated: captured.data.elementsTruncated,
            inaccessibleStylesheets: captured.data.inaccessibleStylesheets,
            discoveredLinks: linkRecords.length,
            networkRequests: networkEntries.length,
            capturedResources: captured.data.resources.filter((payload) => payload.body !== null)
              .length,
            byteSize: screenshotBytes + Buffer.byteLength(captured.data.renderedHtml),
            durationMs: captured.attempts.reduce(
              (total, attempt) => total + attempt.durationMs + (attempt.retryDelayMs ?? 0),
              0,
            ),
          },
          attempts: captured.attempts,
          errors: [],
        });
        pageManifests.push(pageManifest);
        analyzablePages.push({
          route: pageRoute,
          elements: captured.data.elements,
          cssVariables: captured.data.cssVariables,
          breakpoints: captured.data.breakpoints,
        });
        elementCount += captured.data.elements.length;
        completedPages += 1;
        emitProgress(
          'crawling-pages',
          'progress',
          `Crawled ${completedPages} of ${discoveredPages} discovered pages.`,
          captured.data.finalUrl,
          { completed: completedPages, total: Math.max(completedPages, discoveredPages) },
        );
      }
    }

    if (analyzablePages.length === 0) {
      throw (
        lastPageFailure ??
        new SitepullError({
          code: 'CRAWL_FAILED',
          message: 'No HTML page could be captured successfully.',
          stage: 'crawling-pages',
          retryable: true,
        })
      );
    }
    emitProgress(
      'discovering-routes',
      'completed',
      `Route discovery finished with ${discoveredPages} bounded page(s).`,
    );
    emitProgress('crawling-pages', 'completed', `Captured ${analyzablePages.length} page(s).`);

    emitProgress(
      'capturing-assets',
      'started',
      `Cataloging ${resourceStore.count} browser-delivered resource(s).`,
    );
    const resources = resourceStore.entries();
    emitProgress(
      'capturing-assets',
      'completed',
      `Cataloged ${resources.filter((resource) => resource.captured).length} captured resource(s).`,
    );

    emitProgress(
      'extracting-styles',
      'started',
      `Consolidating computed style evidence from ${elementCount} visible element(s).`,
    );
    emitProgress(
      'extracting-styles',
      'completed',
      `Extracted computed style evidence from ${elementCount} visible element(s).`,
    );
    emitProgress('analyzing-design-system', 'started', 'Analyzing computed design evidence.');
    const design = analyzeSiteDesign(analyzablePages);
    const designFiles = {
      designSystemMarkdown: 'design/design-system.md',
      colors: 'design/colors.json',
      typography: 'design/typography.json',
      spacing: 'design/spacing.json',
      radii: 'design/radii.json',
      shadows: 'design/shadows.json',
      breakpoints: 'design/breakpoints.json',
      cssVariables: 'design/css-variables.json',
      components: 'design/components.json',
    } as const;
    await Promise.all([
      writer.writeText(designFiles.designSystemMarkdown, designSystemMarkdown(design)),
      writer.writeJson(designFiles.colors, design.colors),
      writer.writeJson(designFiles.typography, design.typography),
      writer.writeJson(designFiles.spacing, design.spacing),
      writer.writeJson(designFiles.radii, design.radii),
      writer.writeJson(designFiles.shadows, design.shadows),
      writer.writeJson(designFiles.breakpoints, design.breakpoints),
      writer.writeJson(designFiles.cssVariables, design.cssVariables),
      writer.writeJson(designFiles.components, {
        schemaVersion: 1,
        generatedAt: design.generatedAt,
        candidates: design.components,
      }),
    ]);
    emitProgress(
      'analyzing-design-system',
      'completed',
      `Found ${design.components.length} component candidates.`,
    );

    const completedAt = new Date();
    const source = {
      inputUrl: canonicalizeUrl(input.url),
      normalizedUrl,
      origin: `${new URL(normalizedUrl).origin}/`,
      hostname: new URL(normalizedUrl).hostname,
    };
    const metadata = SitepullMetadataSchema.parse({
      schemaVersion: 1,
      generator: { name: 'Sitepull', version: SITEPULL_VERSION },
      captureId: writer.captureId,
      source,
      capturedAt: completedAt.toISOString(),
      config,
    });
    emitProgress('building-ai-pack', 'started', 'Generating AI-ready reference context.');
    await writer.writeText(
      'AI_CONTEXT.md',
      generateAiContext({
        sourceUrl: normalizedUrl,
        capturedAt: completedAt.toISOString(),
        config,
        pages: pageManifests,
        design,
        resources,
      }),
    );
    await writer.writeText('README.md', generatedCaptureReadme(normalizedUrl));
    await writer.writeJson('sitepull.json', metadata);
    await writer.writeJson(
      'assets/manifest.json',
      AssetManifestSchema.parse({
        schemaVersion: 1,
        generatedAt: completedAt.toISOString(),
        resources,
        totalResources: resources.length,
        capturedResources: resources.filter((resource) => resource.captured).length,
        uniqueAssets: resourceStore.uniqueAssetCount,
        totalBytes: resourceStore.totalUniqueBytes,
      }),
    );

    const artifacts = {
      readme: 'README.md',
      aiContext: 'AI_CONTEXT.md',
      sitepullMetadata: 'sitepull.json',
      manifest: 'manifest.json',
      pagesDirectory: 'pages',
      designDirectory: 'design',
      assetsDirectory: 'assets',
      rawDirectory: 'raw',
      logsDirectory: 'logs',
    };
    const baseSummary: CaptureResultSummary = {
      captureId: writer.captureId,
      status: 'completed',
      sourceUrl: source.inputUrl,
      normalizedUrl,
      hostname: source.hostname,
      outputDirectory: writer.plannedFinalPath,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      counts: {
        pages: analyzablePages.length,
        assets: resources.filter((resource) => resource.captured).length,
        components: design.components.length,
        elements: elementCount,
        bytes: resourceStore.totalUniqueBytes,
      },
      aiPack: null,
      fullCapture: null,
      error: null,
    };
    let manifest = CaptureManifestSchema.parse({
      schemaVersion: 1,
      generatorVersion: SITEPULL_VERSION,
      captureId: writer.captureId,
      status: 'completed',
      source,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      config,
      pages: pageManifests,
      resources,
      skippedUrls,
      design,
      designFiles,
      artifacts,
      summary: baseSummary,
      errors: pageManifests.flatMap((page) => page.errors),
    });
    await writer.writeJson('manifest.json', manifest);
    const [aiPackEstimate, fullCaptureEstimate] = await Promise.all([
      selectExportFiles(writer.stagingRoot, 'ai-pack'),
      selectExportFiles(writer.stagingRoot, 'full-capture'),
    ]);
    const summary: CaptureResultSummary = {
      ...baseSummary,
      aiPack: {
        estimatedBytes: aiPackEstimate.estimatedCompressedBytes,
        archivePath: null,
        compressedBytes: null,
      },
      fullCapture: {
        estimatedBytes: fullCaptureEstimate.estimatedCompressedBytes,
        archivePath: null,
        compressedBytes: null,
      },
    };
    manifest = CaptureManifestSchema.parse({ ...manifest, summary });
    await writer.writeJson('manifest.json', manifest);
    emitProgress(
      'building-ai-pack',
      'completed',
      'AI reference context and export selection are ready.',
    );

    emitProgress('packaging', 'started', 'Finalizing the atomic capture project.');
    await logger.close();
    logger = undefined;
    await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    contexts = [];
    await browser.close();
    browser = undefined;
    await networkProxy.close();
    networkProxy = undefined;
    const outputDirectory = await writer.finalize();
    emitProgress('packaging', 'completed', 'Capture project finalized.');
    emit({
      type: 'complete',
      captureId: writer.captureId,
      sequence: sequence++,
      timestamp: new Date().toISOString(),
      result: summary,
    });
    return { outputDirectory, summary, manifest };
  } catch (error) {
    const structured = asSitepullError(error, {
      code: 'INTERNAL_ERROR',
      stage: 'crawling-pages',
      retryable: false,
      message: error instanceof Error ? error.message : 'Sitepull failed unexpectedly.',
    });
    await log('error', structured.message, null, { code: structured.code }).catch(() => undefined);
    if (writer !== undefined) {
      emit({
        type: 'error',
        captureId: writer.captureId,
        sequence: sequence++,
        timestamp: new Date().toISOString(),
        error: serializeError(structured),
      });
    }
    await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
    await browser?.close().catch(() => undefined);
    await networkProxy?.close().catch(() => undefined);
    await logger?.close().catch(() => undefined);
    if (writer !== undefined) {
      if (structured.code === 'CAPTURE_CANCELLED')
        await writer.cleanupCancelled().catch(() => undefined);
      else await writer.preserveFailed().catch(() => undefined);
    }
    throw structured;
  }
}
