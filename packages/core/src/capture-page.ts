import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  ElementRecordSchema,
  type DocumentManifest,
  type ElementRecord,
  type NetworkEntry,
  type ScreenshotManifest,
  type Viewport,
} from '@sitepull/contracts';
import type { BrowserContext, Page, Request, Response } from 'playwright';

import { abortableDelay, throwIfAborted } from './async.js';
import { SitepullError } from './errors.js';
import {
  isNonRetryableHttpClientError,
  isRetryableHttpStatus,
  parseRetryAfterMs,
} from './page-retry.js';
import {
  isPngPixelCountWithinLimit,
  MAX_SCREENSHOT_DECODED_PIXELS,
  readPngIhdrDimensions,
} from './png.js';
import type { ResourceBodyReader } from './resource-budget.js';

const STYLE_PROPERTIES = [
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'height',
  'max-width',
  'max-height',
  'min-width',
  'min-height',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'gap',
  'row-gap',
  'column-gap',
  'flex',
  'flex-basis',
  'flex-direction',
  'flex-flow',
  'flex-grow',
  'flex-shrink',
  'flex-wrap',
  'grid',
  'grid-auto-columns',
  'grid-auto-flow',
  'grid-auto-rows',
  'grid-column',
  'grid-row',
  'grid-template-areas',
  'grid-template-columns',
  'grid-template-rows',
  'align-content',
  'align-items',
  'align-self',
  'justify-content',
  'justify-items',
  'justify-self',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-decoration',
  'text-transform',
  'color',
  'background',
  'background-color',
  'background-image',
  'border',
  'border-width',
  'border-style',
  'border-color',
  'border-radius',
  'box-shadow',
  'opacity',
  'overflow',
  'overflow-x',
  'overflow-y',
  'transform',
  'transition',
  'animation',
  'backdrop-filter',
  'visibility',
  'object-fit',
] as const;

export interface CapturedResourcePayload {
  readonly originalUrl: string;
  readonly finalUrl: string;
  readonly status: number;
  readonly contentType: string | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer | null;
  readonly referencedByPage: string;
  readonly failureReason?: string;
}

export interface CapturePageInput {
  readonly context: BrowserContext;
  readonly url: string;
  readonly route: string;
  readonly viewports: readonly Viewport[];
  readonly pageTimeoutMs: number;
  readonly maxElements: number;
  readonly screenshotsDirectory: string;
  readonly screenshotRelativeDirectory: string;
  readonly resourceBudget: ResourceBodyReader;
  readonly signal?: AbortSignal;
}

export interface RawPageLink {
  readonly href: string;
  readonly resolvedUrl: string | null;
  readonly text: string | null;
}

export interface CapturedPageData {
  readonly url: string;
  readonly finalUrl: string;
  readonly status: number | null;
  readonly contentType: string | null;
  readonly title: string;
  readonly renderedHtml: string;
  readonly document: DocumentManifest;
  readonly elements: readonly ElementRecord[];
  readonly elementsTruncated: boolean;
  readonly links: readonly RawPageLink[];
  readonly network: readonly NetworkEntry[];
  readonly screenshots: readonly ScreenshotManifest[];
  readonly cssVariables: Readonly<Record<string, readonly string[]>>;
  readonly breakpoints: readonly string[];
  readonly inaccessibleStylesheets: number;
  /** Browser-delivered bodies from this successful attempt, not yet committed globally. */
  readonly resources: readonly CapturedResourcePayload[];
  readonly durationMs: number;
}

interface BrowserSnapshot {
  renderedHtml: string;
  title: string;
  language: string | null;
  doctype: string | null;
  contentType: string;
  scrollWidth: number;
  scrollHeight: number;
  meta: Array<{ name?: string; property?: string; httpEquiv?: string; content: string }>;
  elements: Array<{
    tag: string;
    role: string | null;
    text: string | null;
    id: string | null;
    classes: string[];
    domPath: string;
    bounds: { x: number; y: number; width: number; height: number };
    styles: Record<string, string>;
    pseudoElements?: {
      before?: { content: string | null; styles: Record<string, string> };
      after?: { content: string | null; styles: Record<string, string> };
    };
    attributes?: Record<string, string>;
  }>;
  truncated: boolean;
  links: RawPageLink[];
  cssVariables: Record<string, string[]>;
  breakpoints: string[];
  inaccessibleStylesheets: number;
}

async function waitForNetworkQuiet(
  getOutstanding: () => number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + Math.min(timeoutMs, 8_000);
  let quietSince = getOutstanding() === 0 ? Date.now() : 0;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    if (getOutstanding() === 0) {
      quietSince ||= Date.now();
      if (Date.now() - quietSince >= 500) return;
    } else {
      quietSince = 0;
    }
    await abortableDelay(75, signal);
  }
}

async function stabilizePage(
  page: Page,
  getOutstanding: () => number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  await Promise.race([
    page.evaluate(async () => {
      if ('fonts' in document) await document.fonts.ready;
    }),
    abortableDelay(2_500, signal),
  ]).catch(() => undefined);
  await waitForNetworkQuiet(getOutstanding, timeoutMs, signal);

  let previousBottomHeight = -1;
  let stableBottomIterations = 0;
  const scrollDeadline = Date.now() + Math.min(timeoutMs, 8_000);
  for (
    let iteration = 0;
    iteration < 80 && stableBottomIterations < 2 && Date.now() < scrollDeadline;
    iteration += 1
  ) {
    throwIfAborted(signal);
    await page.evaluate(() => {
      window.scrollBy(0, Math.max(320, Math.floor(window.innerHeight * 0.78)));
    });
    await abortableDelay(140, signal);

    const metrics = await page.evaluate(() => ({
      height: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
      y: window.scrollY,
      viewportHeight: window.innerHeight,
    }));
    const atBottom = metrics.y + metrics.viewportHeight >= metrics.height - 1;
    if (!atBottom) {
      stableBottomIterations = 0;
      continue;
    }

    await waitForNetworkQuiet(getOutstanding, Math.min(timeoutMs, 2_500), signal);
    const settledHeight = await page.evaluate(() =>
      Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
    );
    stableBottomIterations =
      settledHeight === previousBottomHeight ? stableBottomIterations + 1 : 0;
    previousBottomHeight = settledHeight;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await waitForNetworkQuiet(getOutstanding, 2_500, signal);
}

async function extractSnapshot(page: Page, maxElements: number): Promise<BrowserSnapshot> {
  return page.evaluate(
    ({ max, styleProperties }) => {
      const readStyles = (style: CSSStyleDeclaration): Record<string, string> => {
        const result: Record<string, string> = {};
        for (const property of styleProperties) {
          const value = style.getPropertyValue(property);
          if (value !== '') result[property] = value;
        }
        return result;
      };

      const domPath = (element: Element): string => {
        const segments: string[] = [];
        let current: Element | null = element;
        while (current !== null && current !== document.documentElement) {
          let segment = current.tagName.toLowerCase();
          if (current.id !== '') {
            segment += `#${CSS.escape(current.id)}`;
            segments.unshift(segment);
            break;
          }
          const parentElement: Element | null = current.parentElement;
          if (parentElement !== null) {
            const currentTagName = current.tagName;
            const peers = [...parentElement.children].filter(
              (child) => child.tagName === currentTagName,
            );
            if (peers.length > 1) segment += `:nth-of-type(${peers.indexOf(current) + 1})`;
          }
          segments.unshift(segment);
          current = parentElement;
        }
        return segments.join(' > ');
      };

      const pseudo = (element: Element, selector: '::before' | '::after') => {
        const style = getComputedStyle(element, selector);
        const content = style.content;
        const materiallyRelevant =
          (content !== 'none' && content !== 'normal' && content !== '""') ||
          style.backgroundImage !== 'none' ||
          style.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
          style.width !== 'auto' ||
          style.height !== 'auto';
        if (!materiallyRelevant) return undefined;
        return {
          content: content === 'none' || content === 'normal' ? null : content,
          styles: readStyles(style),
        };
      };

      const all = [document.body, ...document.body.querySelectorAll('*')];
      const visible = all.filter((element): element is HTMLElement | SVGElement => {
        if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number.parseFloat(style.opacity || '1') > 0
        );
      });
      const selected = visible.slice(0, max);
      const elements = selected.map((element) => {
        const rect = element.getBoundingClientRect();
        const before = pseudo(element, '::before');
        const after = pseudo(element, '::after');
        const text = (element instanceof HTMLElement ? element.innerText : element.textContent)
          ?.replace(/\s+/gu, ' ')
          .trim()
          .slice(0, 20_000);
        const attributes: Record<string, string> = {};
        for (const name of ['aria-label', 'alt', 'href', 'src', 'type', 'name']) {
          const value = element.getAttribute(name);
          if (value !== null) attributes[name] = value.slice(0, 20_000);
        }
        return {
          tag: element.tagName.toLowerCase(),
          role: (() => {
            const explicit = element.getAttribute('role');
            if (explicit !== null) return explicit;
            const roles: Record<string, string> = {
              A: 'link',
              ARTICLE: 'article',
              ASIDE: 'complementary',
              BUTTON: 'button',
              FOOTER: 'contentinfo',
              FORM: 'form',
              H1: 'heading',
              H2: 'heading',
              H3: 'heading',
              H4: 'heading',
              H5: 'heading',
              H6: 'heading',
              HEADER: 'banner',
              IMG: 'img',
              INPUT: 'textbox',
              MAIN: 'main',
              NAV: 'navigation',
              SECTION: 'region',
            };
            return roles[element.tagName] ?? null;
          })(),
          text: text === '' || text === undefined ? null : text,
          id: element.id === '' ? null : element.id,
          classes: [...element.classList].slice(0, 200),
          domPath: domPath(element),
          bounds: {
            x: rect.x + window.scrollX,
            y: rect.y + window.scrollY,
            width: rect.width,
            height: rect.height,
          },
          styles: readStyles(getComputedStyle(element)),
          ...(before !== undefined || after !== undefined
            ? {
                pseudoElements: {
                  ...(before === undefined ? {} : { before }),
                  ...(after === undefined ? {} : { after }),
                },
              }
            : {}),
          ...(Object.keys(attributes).length === 0 ? {} : { attributes }),
        };
      });

      const cssVariables = new Map<string, Set<string>>();
      const addVariable = (name: string, value: string): void => {
        const trimmed = value.trim();
        if (!name.startsWith('--') || trimmed === '') return;
        const values = cssVariables.get(name) ?? new Set<string>();
        values.add(trimmed);
        cssVariables.set(name, values);
      };
      const rootStyle = getComputedStyle(document.documentElement);
      for (let index = 0; index < rootStyle.length; index += 1) {
        const name = rootStyle.item(index);
        if (name.startsWith('--')) addVariable(name, rootStyle.getPropertyValue(name));
      }
      const breakpoints = new Set<string>();
      let inaccessibleStylesheets = 0;
      const inspectRules = (rules: CSSRuleList): void => {
        for (const rule of rules) {
          if (rule instanceof CSSMediaRule) {
            breakpoints.add(rule.conditionText);
            inspectRules(rule.cssRules);
          } else if (rule instanceof CSSStyleRule) {
            for (let index = 0; index < rule.style.length; index += 1) {
              const name = rule.style.item(index);
              if (name.startsWith('--')) addVariable(name, rule.style.getPropertyValue(name));
            }
          } else if ('cssRules' in rule) {
            try {
              inspectRules((rule as CSSGroupingRule).cssRules);
            } catch {
              // Some CSS rule types are intentionally opaque.
            }
          }
        }
      };
      for (const sheet of document.styleSheets) {
        try {
          inspectRules(sheet.cssRules);
        } catch {
          inaccessibleStylesheets += 1;
        }
      }

      const links = [...document.querySelectorAll('a')].map((anchor) => ({
        href: anchor.getAttribute('href') ?? '',
        resolvedUrl: anchor.href === '' ? null : anchor.href,
        text: anchor.textContent?.replace(/\s+/gu, ' ').trim().slice(0, 2_000) || null,
      }));
      const meta = [...document.querySelectorAll('meta')].map((entry) => {
        const property = entry.getAttribute('property');
        return {
          ...(entry.name === '' ? {} : { name: entry.name }),
          ...(property === null ? {} : { property }),
          ...(entry.httpEquiv === '' ? {} : { httpEquiv: entry.httpEquiv }),
          content: entry.content.slice(0, 100_000),
        };
      });

      return {
        renderedHtml: `${document.doctype === null ? '' : '<!DOCTYPE html>\n'}${document.documentElement.outerHTML}`,
        title: document.title,
        language: document.documentElement.lang || null,
        doctype: document.doctype?.name ?? null,
        contentType: document.contentType,
        scrollWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
        scrollHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
        meta,
        elements,
        truncated: visible.length > max,
        links,
        cssVariables: Object.fromEntries(
          [...cssVariables].map(([name, values]) => [name, [...values].sort()]),
        ),
        breakpoints: [...breakpoints].sort(),
        inaccessibleStylesheets,
      };
    },
    { max: maxElements, styleProperties: [...STYLE_PROPERTIES] },
  );
}

async function fileByteSize(filePath: string): Promise<number> {
  return (await stat(filePath)).size;
}

async function validateCapturedScreenshot(filePath: string): Promise<void> {
  const dimensions = await readPngIhdrDimensions(filePath);
  if (dimensions === null) {
    throw new SitepullError({
      code: 'CRAWL_FAILED',
      message: 'The browser produced a malformed PNG screenshot.',
      stage: 'rendering',
    });
  }
  if (!isPngPixelCountWithinLimit(dimensions)) {
    throw new SitepullError({
      code: 'RESOURCE_TOO_LARGE',
      message: `The ${dimensions.width}×${dimensions.height} screenshot exceeds Sitepull's decoded-pixel safety limit.`,
      stage: 'rendering',
      details: {
        width: dimensions.width,
        height: dimensions.height,
        maximumPixels: MAX_SCREENSHOT_DECODED_PIXELS,
      },
    });
  }
}

export async function capturePage(input: CapturePageInput): Promise<CapturedPageData> {
  const startedAt = Date.now();
  throwIfAborted(input.signal);
  const firstViewport = input.viewports[0];
  if (firstViewport === undefined) {
    throw new SitepullError({
      code: 'CRAWL_FAILED',
      message: 'At least one viewport is required.',
    });
  }
  const page = await input.context.newPage();
  await page.setViewportSize({ width: firstViewport.width, height: firstViewport.height });

  const requestStarted = new Map<Request, number>();
  const networkEntries: NetworkEntry[] = [];
  const resourcesToCommit: CapturedResourcePayload[] = [];
  const responseTasks = new Set<Promise<void>>();
  let outstandingRequests = 0;

  const onRequest = (request: Request): void => {
    outstandingRequests += 1;
    requestStarted.set(request, Date.now());
  };
  const completeRequest = (_request: Request): void => {
    outstandingRequests = Math.max(0, outstandingRequests - 1);
  };
  const onRequestFailed = (request: Request): void => {
    completeRequest(request);
    const started = requestStarted.get(request) ?? Date.now();
    const failure = request.failure();
    networkEntries.push({
      url: request.url(),
      method: request.method(),
      kind: 'other',
      status: null,
      contentType: null,
      byteSize: null,
      startedAt: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      failed: true,
      failureText: failure?.errorText ?? 'Request failed',
    });
  };
  const onResponse = (response: Response): void => {
    const task = (async () => {
      const request = response.request();
      const headers = await response.allHeaders();
      const contentType = headers['content-type']?.split(';')[0]?.trim() ?? null;
      const declaredLength = Number.parseInt(headers['content-length'] ?? '', 10);
      const retryableMainDocument =
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame() &&
        isRetryableHttpStatus(response.status());
      let body: Buffer | null = null;
      let failureReason: string | undefined;
      if (retryableMainDocument) {
        failureReason = `Retryable main document response HTTP ${response.status()} is recorded as attempt evidence.`;
      } else {
        const bodyResult = await input.resourceBudget.read({
          declaredBytes:
            Number.isSafeInteger(declaredLength) && declaredLength >= 0 ? declaredLength : null,
          read: () => response.body(),
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        });
        body = bodyResult.body;
        failureReason = bodyResult.failureReason;
      }
      const started = requestStarted.get(request) ?? Date.now();
      networkEntries.push({
        url: response.url(),
        method: request.method(),
        kind: 'other',
        status: response.status(),
        contentType,
        byteSize: body?.byteLength ?? (Number.isFinite(declaredLength) ? declaredLength : null),
        startedAt: new Date(started).toISOString(),
        durationMs: Date.now() - started,
        failed: !response.ok() && response.status() >= 400,
        failureText: response.ok() || response.status() < 400 ? null : `HTTP ${response.status()}`,
      });
      if (!retryableMainDocument) {
        resourcesToCommit.push({
          originalUrl: request.url(),
          finalUrl: response.url(),
          status: response.status(),
          contentType,
          headers,
          body,
          referencedByPage: input.url,
          ...(failureReason === undefined ? {} : { failureReason }),
        });
      }
    })();
    responseTasks.add(task);
    void task.then(
      () => responseTasks.delete(task),
      () => responseTasks.delete(task),
    );
  };

  const drainResponseTasks = async (): Promise<void> => {
    while (responseTasks.size > 0) {
      await Promise.allSettled([...responseTasks]);
    }
  };

  page.on('request', onRequest);
  page.on('requestfinished', completeRequest);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);

  let browserPhase: 'navigation' | 'capture' = 'navigation';
  try {
    const navigation = await page.goto(input.url, {
      waitUntil: 'domcontentloaded',
      timeout: input.pageTimeoutMs,
    });
    browserPhase = 'capture';
    if (navigation === null) {
      throw new SitepullError({
        code: 'NO_HTML_DOCUMENT',
        message: `No HTML document was returned for ${input.url}.`,
        stage: 'rendering',
      });
    }
    const navigationHeaders = await navigation.allHeaders();
    const navigationType = navigationHeaders['content-type'] ?? '';
    const navigationStatus = navigation.status();
    const proxyErrorCode = navigationHeaders['x-sitepull-proxy-error'];
    if (
      navigationStatus === 502 &&
      navigationHeaders['x-sitepull-proxy'] === 'network-policy' &&
      proxyErrorCode !== undefined
    ) {
      throw new SitepullError({
        code: 'CRAWL_FAILED',
        message: `Sitepull's upstream proxy could not reach ${input.url}.`,
        stage: 'rendering',
        retryable: false,
        details: {
          status: navigationStatus,
          proxyErrorCode,
          networkPolicyProxyError: true,
        },
      });
    }
    if (isRetryableHttpStatus(navigationStatus)) {
      const retryAfter = navigationHeaders['retry-after'];
      const retryAfterMs = parseRetryAfterMs(retryAfter);
      throw new SitepullError({
        code: 'HTTP_RETRYABLE_STATUS',
        message: `The site returned retryable HTTP ${navigationStatus} for ${input.url}.`,
        stage: 'rendering',
        retryable: true,
        details: {
          status: navigationStatus,
          ...(retryAfter === undefined ? {} : { retryAfter }),
          ...(retryAfterMs === null ? {} : { retryAfterMs }),
        },
      });
    }
    if (navigationStatus === 403) {
      throw new SitepullError({
        code: 'HTTP_FORBIDDEN',
        message: `The site returned HTTP 403 for ${input.url}.`,
        stage: 'rendering',
        retryable: false,
        details: {
          status: navigationStatus,
          statusText: navigation.statusText(),
          url: input.url,
          finalUrl: navigation.url(),
        },
      });
    }
    if (isNonRetryableHttpClientError(navigationStatus)) {
      const statusText = navigation.statusText().trim();
      throw new SitepullError({
        code: 'HTTP_CLIENT_ERROR',
        message: `The site returned HTTP ${navigationStatus}${statusText === '' ? '' : ` ${statusText}`} for ${input.url}.`,
        stage: 'rendering',
        retryable: false,
        details: {
          status: navigationStatus,
          statusText,
          url: input.url,
          finalUrl: navigation.url(),
        },
      });
    }
    if (!navigationType.toLowerCase().includes('text/html')) {
      throw new SitepullError({
        code: 'NO_HTML_DOCUMENT',
        message: `The URL returned ${navigationType || 'a non-HTML response'}.`,
        stage: 'rendering',
        details: { status: navigationStatus, contentType: navigationType },
      });
    }

    await stabilizePage(page, () => outstandingRequests, input.pageTimeoutMs, input.signal);
    const snapshot = await extractSnapshot(page, input.maxElements);
    const parsedElements = snapshot.elements.map((element) => ElementRecordSchema.parse(element));

    await mkdir(input.screenshotsDirectory, { recursive: true });
    const screenshots: ScreenshotManifest[] = [];
    for (const viewport of input.viewports) {
      throwIfAborted(input.signal);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.evaluate(() => window.scrollTo(0, 0));
      await abortableDelay(180, input.signal);
      const viewportName = `${viewport.name}.png`;
      const fullName = `${viewport.name}-full.png`;
      const viewportPath = path.join(input.screenshotsDirectory, viewportName);
      const fullPath = path.join(input.screenshotsDirectory, fullName);
      await page.screenshot({
        path: viewportPath,
        fullPage: false,
        type: 'png',
        animations: 'disabled',
      });
      await validateCapturedScreenshot(viewportPath);
      await page.screenshot({
        path: fullPath,
        fullPage: true,
        type: 'png',
        animations: 'disabled',
      });
      await validateCapturedScreenshot(fullPath);
      screenshots.push({
        viewport,
        viewportPath: `${input.screenshotRelativeDirectory}/${viewportName}`,
        fullPagePath: `${input.screenshotRelativeDirectory}/${fullName}`,
        viewportByteSize: await fileByteSize(viewportPath),
        fullPageByteSize: await fileByteSize(fullPath),
      });
    }
    page.off('response', onResponse);
    await drainResponseTasks();
    throwIfAborted(input.signal);

    return {
      url: input.url,
      finalUrl: page.url(),
      status: navigationStatus,
      contentType: navigationType,
      title: snapshot.title,
      renderedHtml: snapshot.renderedHtml,
      document: {
        schemaVersion: 1,
        url: page.url(),
        canonicalUrl: page.url(),
        route: input.route,
        title: snapshot.title,
        language: snapshot.language,
        doctype: snapshot.doctype,
        contentType: snapshot.contentType,
        capturedAt: new Date().toISOString(),
        viewport: firstViewport,
        scrollWidth: Math.max(0, Math.round(snapshot.scrollWidth)),
        scrollHeight: Math.max(0, Math.round(snapshot.scrollHeight)),
        meta: snapshot.meta,
      },
      elements: parsedElements,
      elementsTruncated: snapshot.truncated,
      links: snapshot.links,
      network: networkEntries,
      screenshots,
      cssVariables: snapshot.cssVariables,
      breakpoints: snapshot.breakpoints,
      inaccessibleStylesheets: snapshot.inaccessibleStylesheets,
      resources: resourcesToCommit,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error instanceof SitepullError) throw error;
    if (input.signal?.aborted === true) {
      throw new SitepullError({
        code: 'CAPTURE_CANCELLED',
        message: 'The capture was cancelled.',
        cause: error,
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|could not resolve host/iu.test(message)) {
      throw new SitepullError({
        code: 'DNS_FAILED',
        message: `Could not resolve host ${new URL(input.url).hostname}.`,
        stage: 'rendering',
        retryable: true,
        details: { browserPhase },
        cause: error,
      });
    }
    if (/ERR_CERT|certificate|TLS|SSL/iu.test(message)) {
      throw new SitepullError({
        code: 'TLS_FAILED',
        message: `TLS connection failed for ${new URL(input.url).hostname}.`,
        stage: 'rendering',
        retryable: true,
        details: { browserPhase },
        cause: error,
      });
    }
    if (/timeout/iu.test(message)) {
      throw new SitepullError({
        code: 'NAVIGATION_TIMEOUT',
        message: `Navigation timed out after ${input.pageTimeoutMs} ms for ${input.url}.`,
        stage: 'rendering',
        retryable: true,
        details: { browserPhase },
        cause: error,
      });
    }
    throw new SitepullError({
      code: 'CRAWL_FAILED',
      message: `Could not capture ${input.url}: ${message}`,
      stage: 'crawling-pages',
      retryable: true,
      details: { browserPhase },
      cause: error,
    });
  } finally {
    page.removeAllListeners();
    await page.close().catch(() => undefined);
    await drainResponseTasks();
  }
}
