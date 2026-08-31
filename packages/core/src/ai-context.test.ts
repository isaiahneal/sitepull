import {
  DEFAULT_CRAWL_CONFIG,
  DesignManifestSchema,
  PageManifestSchema,
  ResourceManifestEntrySchema,
} from '@sitepull/contracts';
import { describe, expect, it } from 'vitest';

import { generateAiContext } from './ai-context.js';

const capturedAt = '2026-08-30T12:00:00.000Z';

function page(status: 'captured' | 'failed') {
  return PageManifestSchema.parse({
    id: status === 'captured' ? 'home' : 'pricing',
    route: status === 'captured' ? '/' : '/pricing',
    url: `https://example.com${status === 'captured' ? '/' : '/pricing'}`,
    canonicalUrl: `https://example.com${status === 'captured' ? '/' : '/pricing'}`,
    title: status === 'captured' ? 'Example' : '',
    contentType: status === 'captured' ? 'text/html' : null,
    httpStatus: status === 'captured' ? 200 : 503,
    depth: status === 'captured' ? 0 : 1,
    status,
    capturedAt,
    files:
      status === 'captured'
        ? {
            renderedHtml: 'pages/home/rendered.html',
            document: 'pages/home/document.json',
            elements: 'pages/home/elements.json',
            links: 'pages/home/links.json',
            network: 'pages/home/network.json',
          }
        : null,
    screenshots: [],
    metrics: {
      visibleElements: status === 'captured' ? 12 : 0,
      discoveredLinks: 0,
      networkRequests: 0,
      capturedResources: 0,
      byteSize: 0,
      durationMs: 10,
    },
    attempts:
      status === 'captured'
        ? [
            {
              attempt: 1,
              startedAt: capturedAt,
              completedAt: capturedAt,
              durationMs: 10,
              outcome: 'captured',
              httpStatus: 200,
            },
          ]
        : [
            {
              attempt: 1,
              startedAt: capturedAt,
              completedAt: capturedAt,
              durationMs: 10,
              outcome: 'failed',
              httpStatus: 503,
              error: {
                name: 'SitepullError',
                code: 'HTTP_RETRYABLE_STATUS',
                message: 'The site returned retryable HTTP 503.',
                stage: 'rendering',
                retryable: true,
              },
            },
          ],
    errors:
      status === 'captured'
        ? []
        : [
            {
              name: 'SitepullError',
              code: 'HTTP_RETRYABLE_STATUS',
              message: 'The site returned retryable HTTP 503.',
              stage: 'rendering',
              retryable: true,
            },
          ],
  });
}

describe('AI capture coverage context', () => {
  it('labels partial evidence and avoids claiming viewport-isolated rendering', () => {
    const markdown = generateAiContext({
      sourceUrl: 'https://example.com/',
      capturedAt,
      config: DEFAULT_CRAWL_CONFIG,
      pages: [page('captured'), page('failed')],
      design: DesignManifestSchema.parse({
        schemaVersion: 1,
        generatedAt: capturedAt,
        sourcePageCount: 1,
        colors: [],
        typography: [],
        spacing: [],
        radii: [],
        shadows: [],
        borders: [],
        breakpoints: [],
        cssVariables: [],
        components: [],
      }),
      resources: [
        ResourceManifestEntrySchema.parse({
          originalUrl: 'https://example.com/hero.png',
          kind: 'image',
          contentType: 'image/png',
          httpStatus: 200,
          localPath: null,
          byteSize: 0,
          sha256: null,
          referencedByPages: ['https://example.com/'],
          captured: false,
          failureReason: 'Capture resource budget is exhausted.',
        }),
      ],
    });

    expect(markdown).toContain('## Capture Coverage');
    expect(markdown).toContain('**partial; review the gaps below');
    expect(markdown).toContain('Pages: 1 captured of 2 attempted; 1 failed');
    expect(markdown).toContain('Failed routes: `/pricing`');
    expect(markdown).toContain('Resource gap examples');
    expect(markdown).toContain(
      'Resource body limits: 25.0 MB per response, 512.0 MB aggregate, 3 concurrent body reads',
    );
    expect(markdown).toContain('after resizing the stabilized page');
    expect(markdown).not.toContain('rendered independently');
  });

  it('labels element truncation and inaccessible stylesheet rules as partial evidence', () => {
    const capturedPage = page('captured');
    const limitedPage = PageManifestSchema.parse({
      ...capturedPage,
      metrics: {
        ...capturedPage.metrics,
        visibleElements: DEFAULT_CRAWL_CONFIG.maxElementsPerPage,
        elementsTruncated: true,
        inaccessibleStylesheets: 2,
      },
    });
    const markdown = generateAiContext({
      sourceUrl: 'https://example.com/',
      capturedAt,
      config: DEFAULT_CRAWL_CONFIG,
      pages: [limitedPage],
      design: DesignManifestSchema.parse({
        schemaVersion: 1,
        generatedAt: capturedAt,
        sourcePageCount: 1,
        colors: [],
        typography: [],
        spacing: [],
        radii: [],
        shadows: [],
        borders: [],
        breakpoints: [],
        cssVariables: [],
        components: [],
      }),
      resources: [],
    });

    expect(markdown).toContain('**partial; review the gaps below');
    expect(markdown).toContain(
      '1 captured page(s) reached the configured 10,000-visible-element bound (`/`)',
    );
    expect(markdown).toContain('2 rule list(s) across 1 captured page(s) were inaccessible (`/`)');
    expect(markdown).toContain(
      'Evidence limits: visible-element inventory truncated; 2 inaccessible stylesheet rule lists',
    );
  });

  it('does not claim legacy page evidence is complete when limit telemetry was never recorded', () => {
    const markdown = generateAiContext({
      sourceUrl: 'https://example.com/',
      capturedAt,
      config: DEFAULT_CRAWL_CONFIG,
      pages: [page('captured')],
      design: DesignManifestSchema.parse({
        schemaVersion: 1,
        generatedAt: capturedAt,
        sourcePageCount: 1,
        colors: [],
        typography: [],
        spacing: [],
        radii: [],
        shadows: [],
        borders: [],
        breakpoints: [],
        cssVariables: [],
        components: [],
      }),
      resources: [],
    });

    expect(markdown).toContain('**partial; review the gaps below');
    expect(markdown).toContain('truncation telemetry is unavailable for 1 legacy page record(s)');
    expect(markdown).toContain('access telemetry is unavailable for 1 legacy page record(s)');
    expect(markdown).toContain('element-truncation telemetry unavailable (legacy manifest)');
  });

  it('labels a captured HTTP error body as a resource evidence gap', () => {
    const capturedPage = page('captured');
    const fullyReportedPage = PageManifestSchema.parse({
      ...capturedPage,
      metrics: {
        ...capturedPage.metrics,
        elementsTruncated: false,
        inaccessibleStylesheets: 0,
      },
    });
    const markdown = generateAiContext({
      sourceUrl: 'https://example.com/',
      capturedAt,
      config: DEFAULT_CRAWL_CONFIG,
      pages: [fullyReportedPage],
      design: DesignManifestSchema.parse({
        schemaVersion: 1,
        generatedAt: capturedAt,
        sourcePageCount: 1,
        colors: [],
        typography: [],
        spacing: [],
        radii: [],
        shadows: [],
        borders: [],
        breakpoints: [],
        cssVariables: [],
        components: [],
      }),
      resources: [
        ResourceManifestEntrySchema.parse({
          originalUrl: 'https://example.com/missing.png',
          kind: 'image',
          contentType: 'image/png',
          httpStatus: 404,
          localPath: 'assets/images/missing.png',
          byteSize: 12,
          sha256: 'a'.repeat(64),
          referencedByPages: ['https://example.com/'],
          captured: true,
        }),
      ],
    });

    expect(markdown).toContain('**partial; review the gaps below');
    expect(markdown).toContain('1 returned HTTP error status');
    expect(markdown).toContain(
      'Resource HTTP-error examples: `https://example.com/missing.png` (HTTP 404; error body saved)',
    );
    expect(markdown).not.toContain('`assets/images/missing.png`');
  });
});
