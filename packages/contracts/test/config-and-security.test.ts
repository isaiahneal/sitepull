import { describe, expect, it } from 'vitest';

import {
  CaptureJobSnapshotSchema,
  CrawlConfigSchema,
  CrawlRequestSchema,
  DEFAULT_CRAWL_CONFIG,
  DEFAULT_MAX_CAPTURE_RESOURCE_BYTES,
  DEFAULT_MAX_RESOURCE_BYTES,
  DEFAULT_RESOURCE_BODY_CONCURRENCY,
  HttpUrlSchema,
  IpcRequestSchema,
  normalizeHttpUrlInput,
  ReadCaptureFilePayloadSchema,
  SafeRelativePathSchema,
  StartCapturePayloadSchema,
  StartCaptureResultSchema,
  VIEWPORT_PRESETS,
} from '../src/index.js';

describe('crawl configuration contracts', () => {
  it('resolves the documented WebKit-first defaults', () => {
    expect(CrawlConfigSchema.parse({})).toEqual({
      engine: 'webkit',
      maxDepth: 2,
      maxPages: 25,
      sameOriginOnly: true,
      includeSubdomains: false,
      viewports: [VIEWPORT_PRESETS.desktop, VIEWPORT_PRESETS.mobile],
      pageTimeoutMs: 30_000,
      crawlConcurrency: 3,
      maxElementsPerPage: 10_000,
      maxResourceBytes: DEFAULT_MAX_RESOURCE_BYTES,
      maxCaptureResourceBytes: DEFAULT_MAX_CAPTURE_RESOURCE_BYTES,
      resourceBodyConcurrency: DEFAULT_RESOURCE_BODY_CONCURRENCY,
      headed: false,
    });
    expect(DEFAULT_CRAWL_CONFIG).toEqual(CrawlConfigSchema.parse({}));
  });

  it('accepts bounded advanced settings and defaults a crawl request config', () => {
    const request = CrawlRequestSchema.parse({
      url: 'https://example.com/path?campaign=spring',
      outputDirectory: '/tmp/sitepull-output',
    });

    expect(request.config.engine).toBe('webkit');
    expect(request.config.viewports).toHaveLength(2);
    expect(
      CrawlConfigSchema.safeParse({
        engine: 'firefox',
        maxDepth: 4,
        maxPages: 100,
        sameOriginOnly: false,
        includeSubdomains: false,
        viewports: [VIEWPORT_PRESETS.tablet],
        pageTimeoutMs: 45_000,
        crawlConcurrency: 5,
        maxElementsPerPage: 20_000,
        maxResourceBytes: 16 * 1024 * 1024,
        maxCaptureResourceBytes: 256 * 1024 * 1024,
        resourceBodyConcurrency: 2,
        headed: true,
      }).success,
    ).toBe(true);
  });

  it('rejects invalid resource body budgets', () => {
    expect(CrawlConfigSchema.safeParse({ maxResourceBytes: 0 }).success).toBe(false);
    expect(CrawlConfigSchema.safeParse({ maxCaptureResourceBytes: 0 }).success).toBe(false);
    expect(CrawlConfigSchema.safeParse({ resourceBodyConcurrency: 17 }).success).toBe(false);
  });

  it('rejects duplicate viewport names and unknown configuration keys', () => {
    expect(
      CrawlConfigSchema.safeParse({
        viewports: [VIEWPORT_PRESETS.desktop, { name: 'desktop', width: 1280, height: 720 }],
      }).success,
    ).toBe(false);

    expect(
      CrawlConfigSchema.safeParse({
        executeDownloadedJavascript: true,
      }).success,
    ).toBe(false);
  });

  it('allows only HTTP and HTTPS crawl targets', () => {
    expect(HttpUrlSchema.safeParse('https://example.com').success).toBe(true);
    expect(HttpUrlSchema.safeParse('http://localhost:4173/docs').success).toBe(true);
    expect(HttpUrlSchema.safeParse('file:///etc/passwd').success).toBe(false);
    expect(HttpUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(HttpUrlSchema.safeParse('mailto:person@example.com').success).toBe(false);
    expect(HttpUrlSchema.safeParse('https://user:secret@example.com').success).toBe(false);
  });

  it('prefers HTTPS for bare website inputs without downgrading explicit URLs', () => {
    expect(normalizeHttpUrlInput('example.com/docs')).toEqual({
      url: 'https://example.com/docs',
      protocolInferred: true,
    });
    expect(normalizeHttpUrlInput('http://example.com')).toEqual({
      url: 'http://example.com/',
      protocolInferred: false,
    });
    expect(() => normalizeHttpUrlInput('file:///etc/passwd')).toThrow(/HTTP and HTTPS/u);
  });
});

describe('capture-relative path contracts', () => {
  it.each([
    '../secrets.txt',
    'pages/../../secrets.txt',
    '%2e%2e/secrets.txt',
    '%252e%252e/secrets.txt',
    '/etc/passwd',
    'C:/Windows/system.ini',
    'pages\\..\\secrets.txt',
    'pages//rendered.html',
  ])('rejects unsafe path %s', (unsafePath) => {
    expect(SafeRelativePathSchema.safeParse(unsafePath).success).toBe(false);
  });

  it('accepts a normal capture-relative path', () => {
    expect(SafeRelativePathSchema.parse('pages/home/rendered.html')).toBe(
      'pages/home/rendered.html',
    );
  });

  it('does not let renderer IPC payloads carry arbitrary privileged fields', () => {
    expect(
      StartCapturePayloadSchema.safeParse({
        url: 'https://example.com',
        shellCommand: 'open /Applications/Terminal.app',
      }).success,
    ).toBe(false);

    expect(
      ReadCaptureFilePayloadSchema.safeParse({
        captureId: 'capture-123',
        relativePath: '../../Library/Keychains/login.keychain-db',
      }).success,
    ).toBe(false);
  });

  it('binds each IPC channel to its own strict payload shape', () => {
    expect(
      IpcRequestSchema.safeParse({
        channel: 'sitepull:capture:cancel',
        payload: { url: 'https://example.com' },
      }).success,
    ).toBe(false);

    expect(
      IpcRequestSchema.safeParse({
        channel: 'sitepull:capture:cancel',
        payload: { captureId: 'capture-123' },
      }).success,
    ).toBe(true);
    expect(
      IpcRequestSchema.safeParse({
        channel: 'sitepull:capture:job:get',
        payload: {},
      }).success,
    ).toBe(true);
  });

  it('accepts only ordered owner-job replay snapshots with one terminal event at the end', () => {
    const recipe = {
      url: 'https://example.com/',
      allowHttpFallback: false,
      outputDirectory: '/tmp/sitepull',
      config: {},
    };
    const events = [
      {
        type: 'log' as const,
        captureId: 'capture-123',
        sequence: 4,
        timestamp: '2026-08-30T12:00:00.000Z',
        level: 'info' as const,
        stage: 'rendering' as const,
        message: 'Rendering the page.',
      },
      {
        type: 'error' as const,
        captureId: 'capture-123',
        sequence: 5,
        timestamp: '2026-08-30T12:00:01.000Z',
        error: {
          name: 'SitepullError' as const,
          code: 'NAVIGATION_TIMEOUT' as const,
          message: 'Navigation timed out.',
          stage: 'rendering' as const,
          retryable: true,
        },
      },
    ];

    expect(
      CaptureJobSnapshotSchema.safeParse({
        state: 'terminal',
        captureId: 'capture-123',
        recipe,
        events,
      }).success,
    ).toBe(true);
    expect(
      CaptureJobSnapshotSchema.safeParse({
        state: 'active',
        captureId: 'capture-123',
        recipe,
        events,
      }).success,
    ).toBe(false);
    expect(
      CaptureJobSnapshotSchema.safeParse({
        state: 'terminal',
        captureId: 'capture-123',
        recipe,
        events: [...events].reverse(),
      }).success,
    ).toBe(false);
    expect(
      CaptureJobSnapshotSchema.safeParse({
        state: 'terminal',
        captureId: 'capture-other',
        recipe,
        events,
      }).success,
    ).toBe(false);
  });

  it('returns the exact normalized desktop recipe with a started capture', () => {
    const parsed = StartCaptureResultSchema.parse({
      captureId: 'capture-123',
      recipe: {
        url: 'https://example.com/',
        allowHttpFallback: true,
        outputDirectory: '/tmp/sitepull',
        config: { maxDepth: 3 },
      },
    });

    expect(parsed.recipe.config).toEqual({
      ...DEFAULT_CRAWL_CONFIG,
      maxDepth: 3,
    });
  });
});
