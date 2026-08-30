import { describe, expect, it } from 'vitest';

import {
  AssetManifestSchema,
  ColorTokenSchema,
  ComponentCandidateSchema,
  ElementRecordSchema,
  ElementsManifestSchema,
  ProgressEventSchema,
  ResourceManifestEntrySchema,
  SitepullErrorSchema,
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

describe('design and live-progress contracts', () => {
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
