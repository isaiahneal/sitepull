import { describe, expect, it } from 'vitest';

import {
  AssetManifestSchema,
  ColorTokenSchema,
  ComponentCandidateSchema,
  ElementRecordSchema,
  ElementsManifestSchema,
  MeasurementTokenSchema,
  PageMetricsSchema,
  ProgressEventSchema,
  PageCaptureAttemptSchema,
  ResourceManifestEntrySchema,
  SitepullErrorSchema,
  SpacingTokenSchema,
} from '../src/index.js';

const capturedAt = '2026-08-30T12:00:00.000Z';

const element = {
  tag: 'h1',
  role: 'heading',
  text: 'Example',
  id: null,
  classes: ['hero-title'],
  domPath: 'html > body > main > h1:nth-child(1)',
  bounds: { x: 0, y: 24, width: 720, height: 76 },
  styles: {
    display: 'block',
    'font-family': 'Inter, sans-serif',
    'font-size': '64px',
    'line-height': '67.84px',
    color: 'rgb(17, 24, 39)',
  },
};

describe('rendered element contracts', () => {
  it('accepts the reconstruction-focused computed style subset', () => {
    expect(ElementRecordSchema.parse(element)).toEqual(element);
  });

  it('rejects arbitrary computed CSS properties', () => {
    expect(
      ElementRecordSchema.safeParse({
        ...element,
        styles: { ...element.styles, '-webkit-user-modify': 'read-write' },
      }).success,
    ).toBe(false);
  });

  it('guards manifest counters against truncated or corrupt output', () => {
    expect(
      ElementsManifestSchema.safeParse({
        schemaVersion: 1,
        pageUrl: 'https://example.com/',
        capturedAt,
        elementCount: 2,
        truncated: false,
        maxElements: 10_000,
        elements: [element],
      }).success,
    ).toBe(false);
  });
});

describe('resource contracts', () => {
  const resource = {
    originalUrl: 'https://example.com/assets/hero.svg',
    kind: 'svg',
    contentType: 'image/svg+xml',
    httpStatus: 200,
    localPath: 'assets/svg/hero.svg',
    byteSize: 412,
    sha256: 'a'.repeat(64),
    referencedByPages: ['https://example.com/'],
    captured: true,
  };

  it('validates a captured asset mapping with content identity', () => {
    expect(ResourceManifestEntrySchema.parse(resource)).toEqual(resource);
  });

  it('requires a hash and local path for captured resources', () => {
    expect(
      ResourceManifestEntrySchema.safeParse({
        ...resource,
        localPath: null,
        sha256: null,
      }).success,
    ).toBe(false);
  });

  it('records a pre-response resource gap with the HTTP status sentinel', () => {
    const gap = {
      ...resource,
      originalUrl: 'https://example.com/assets/app.js.map',
      kind: 'source-map' as const,
      contentType: null,
      httpStatus: 0,
      localPath: null,
      byteSize: 0,
      sha256: null,
      captured: false,
      failureReason: 'Capture resource budget is exhausted.',
    };

    expect(ResourceManifestEntrySchema.parse(gap)).toEqual(gap);
  });

  it('checks aggregate resource counts', () => {
    expect(
      AssetManifestSchema.safeParse({
        schemaVersion: 1,
        generatedAt: capturedAt,
        resources: [resource],
        totalResources: 2,
        capturedResources: 1,
        uniqueAssets: 1,
        totalBytes: 412,
      }).success,
    ).toBe(false);
  });
});

describe('page attempt evidence', () => {
  const retryError = {
    name: 'SitepullError' as const,
    code: 'HTTP_RETRYABLE_STATUS' as const,
    message: 'The site returned retryable HTTP 429.',
    stage: 'rendering' as const,
    retryable: true,
    details: { status: 429, retryAfterMs: 1_000 },
  };

  it('requires structured errors and delays for retrying attempts', () => {
    const attempt = {
      attempt: 1,
      startedAt: capturedAt,
      completedAt: capturedAt,
      durationMs: 20,
      outcome: 'retrying' as const,
      httpStatus: 429,
      retryDelayMs: 1_000,
      error: retryError,
    };
    expect(PageCaptureAttemptSchema.parse(attempt)).toEqual(attempt);
    expect(
      PageCaptureAttemptSchema.safeParse({ ...attempt, retryDelayMs: undefined }).success,
    ).toBe(false);
  });

  it('does not attach failure evidence to captured attempts', () => {
    expect(
      PageCaptureAttemptSchema.safeParse({
        attempt: 2,
        startedAt: capturedAt,
        completedAt: capturedAt,
        durationMs: 1_200,
        outcome: 'captured',
        httpStatus: 200,
        error: retryError,
      }).success,
    ).toBe(false);
  });

  it('accepts a structured, non-retryable HTTP client error', () => {
    const error = {
      name: 'SitepullError' as const,
      code: 'HTTP_CLIENT_ERROR' as const,
      message: 'The site returned HTTP 404 Not Found.',
      stage: 'rendering' as const,
      retryable: false,
      details: {
        status: 404,
        statusText: 'Not Found',
        url: 'https://example.com/missing',
        finalUrl: 'https://example.com/missing',
      },
    };

    expect(SitepullErrorSchema.parse(error)).toEqual(error);
  });
});

describe('page extraction evidence', () => {
  const metrics = {
    visibleElements: 10_000,
    discoveredLinks: 12,
    networkRequests: 24,
    capturedResources: 18,
    byteSize: 1_024,
    durationMs: 500,
  };

  it('persists bounded-element and stylesheet-access signals', () => {
    expect(
      PageMetricsSchema.parse({
        ...metrics,
        elementsTruncated: true,
        inaccessibleStylesheets: 2,
      }),
    ).toMatchObject({ elementsTruncated: true, inaccessibleStylesheets: 2 });
  });

  it('keeps v0.1 page metrics readable without inventing evidence signals', () => {
    const parsed = PageMetricsSchema.parse(metrics);

    expect(parsed.elementsTruncated).toBeUndefined();
    expect(parsed.inaccessibleStylesheets).toBeUndefined();
  });

  it('rejects a negative inaccessible stylesheet count', () => {
    expect(PageMetricsSchema.safeParse({ ...metrics, inaccessibleStylesheets: -1 }).success).toBe(
      false,
    );
  });
});

describe('design and live-progress contracts', () => {
  it('allows signed margins while keeping other measurement domains nonnegative', () => {
    const negativeMargin = {
      value: '-21.265625px',
      pixels: -21.265625,
      occurrences: 2,
      contexts: ['margin', 'margin-top'],
      routes: ['/', '/about'],
    };

    expect(SpacingTokenSchema.parse(negativeMargin)).toEqual(negativeMargin);
    expect(
      SpacingTokenSchema.safeParse({ ...negativeMargin, contexts: ['padding-top'] }).success,
    ).toBe(false);
    expect(
      MeasurementTokenSchema.safeParse({ ...negativeMargin, contexts: ['border-radius'] }).success,
    ).toBe(false);
    expect(
      SpacingTokenSchema.safeParse({
        ...negativeMargin,
        value: '-1rem',
        pixels: null,
        contexts: ['gap'],
      }).success,
    ).toBe(false);
    expect(
      MeasurementTokenSchema.safeParse({
        ...negativeMargin,
        value: '-1rem',
        pixels: null,
        contexts: ['border-radius'],
      }).success,
    ).toBe(false);
    expect(
      SpacingTokenSchema.safeParse({
        ...negativeMargin,
        value: '-1rem',
        pixels: null,
        contexts: ['margin-left'],
      }).success,
    ).toBe(true);
  });

  it('keeps semantic color labels explicitly evidence-qualified', () => {
    expect(
      ColorTokenSchema.safeParse({
        normalizedValue: '#ffffff',
        rawValues: ['rgb(255, 255, 255)'],
        occurrences: 12,
        routes: ['/'],
        inferredRole: 'page-background',
        confidence: null,
      }).success,
    ).toBe(false);
  });

  it('requires inferred component names to be labelled as inferred', () => {
    const candidate = {
      suggestedName: 'FeatureCard',
      confidence: 0.87,
      occurrences: 6,
      routes: ['/', '/features'],
      signature: 'article>h3+p',
      styleSummary: { 'border-radius': '16px', padding: '24px' },
      examples: [{ route: '/', domPath: 'main > article:nth-child(2)' }],
    };

    expect(ComponentCandidateSchema.safeParse(candidate).success).toBe(false);
    expect(ComponentCandidateSchema.safeParse({ ...candidate, nameIsInferred: true }).success).toBe(
      true,
    );
  });

  it('prevents misleading page progress counters', () => {
    expect(
      ProgressEventSchema.safeParse({
        type: 'progress',
        captureId: 'capture-123',
        sequence: 4,
        timestamp: capturedAt,
        stage: 'crawling-pages',
        state: 'progress',
        message: 'Crawling pages',
        currentUrl: 'https://example.com/features',
        elapsedMs: 1_200,
        counters: {
          discoveredPages: 2,
          completedPages: 3,
          assets: 8,
          elements: 230,
          bytesCaptured: 45_000,
        },
        determinate: { completed: 3, total: 2 },
      }).success,
    ).toBe(false);
  });

  it('accepts only serializable, actionable errors at the IPC boundary', () => {
    expect(
      SitepullErrorSchema.safeParse({
        name: 'SitepullError',
        code: 'NAVIGATION_TIMEOUT',
        message: 'Navigation exceeded the configured 30 second limit.',
        stage: 'rendering',
        retryable: true,
        details: { timeoutMs: 30_000 },
      }).success,
    ).toBe(true);

    expect(
      SitepullErrorSchema.safeParse({
        name: 'SitepullError',
        code: 'NAVIGATION_TIMEOUT',
        message: 'Timed out',
        retryable: true,
        stack: 'private implementation detail',
      }).success,
    ).toBe(false);
  });
});
