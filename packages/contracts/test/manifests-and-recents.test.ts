import { describe, expect, it } from 'vitest';

import {
  CaptureManifestSchema,
  CaptureRecipeSchema,
  proxyPoolRecipeFromRequest,
  RecentsIndexSchema,
  RecentCaptureSchema,
} from '../src/index.js';

const capturedAt = '2026-08-30T12:00:00.000Z';

function completeManifest() {
  return {
    schemaVersion: 1 as const,
    generatorVersion: '0.1.0',
    captureId: 'capture-123',
    status: 'completed' as const,
    source: {
      inputUrl: 'https://example.com',
      normalizedUrl: 'https://example.com/',
      origin: 'https://example.com',
      hostname: 'example.com',
    },
    startedAt: capturedAt,
    completedAt: '2026-08-30T12:00:04.500Z',
    config: {},
    pages: [],
    resources: [],
    skippedUrls: [],
    design: {
      schemaVersion: 1 as const,
      generatedAt: capturedAt,
      sourcePageCount: 0,
      colors: [],
      typography: [],
      spacing: [
        {
          value: '-21.265625px',
          pixels: -21.265625,
          occurrences: 2,
          contexts: ['margin', 'margin-top'],
          routes: ['/'],
        },
      ],
      radii: [],
      shadows: [],
      borders: [],
      breakpoints: [],
      cssVariables: [],
      components: [],
    },
    designFiles: {
      designSystemMarkdown: 'design/design-system.md',
      colors: 'design/colors.json',
      typography: 'design/typography.json',
      spacing: 'design/spacing.json',
      radii: 'design/radii.json',
      shadows: 'design/shadows.json',
      breakpoints: 'design/breakpoints.json',
      cssVariables: 'design/css-variables.json',
      components: 'design/components.json',
    },
    artifacts: {
      readme: 'README.md',
      aiContext: 'AI_CONTEXT.md',
      sitepullMetadata: 'sitepull.json',
      manifest: 'manifest.json',
      pagesDirectory: 'pages',
      designDirectory: 'design',
      assetsDirectory: 'assets',
      rawDirectory: 'raw',
      logsDirectory: 'logs',
    },
    summary: {
      captureId: 'capture-123',
      status: 'completed' as const,
      sourceUrl: 'https://example.com',
      normalizedUrl: 'https://example.com/',
      hostname: 'example.com',
      outputDirectory: '/tmp/sitepull/example.com-2026-08-30',
      startedAt: capturedAt,
      completedAt: '2026-08-30T12:00:04.500Z',
      durationMs: 4_500,
      counts: { pages: 0, assets: 0, components: 0, elements: 0, bytes: 0 },
      aiPack: { estimatedBytes: 0, archivePath: null, compressedBytes: null },
      fullCapture: null,
      error: null,
    },
    errors: [],
  };
}

describe('capture manifest', () => {
  it('applies nested config defaults while validating a coherent manifest', () => {
    const parsed = CaptureManifestSchema.parse(completeManifest());

    expect(parsed.config.engine).toBe('webkit');
    expect(parsed.config.maxPages).toBe(25);
    expect(parsed.summary.captureId).toBe(parsed.captureId);
    expect(parsed.design.spacing[0]?.pixels).toBe(-21.265625);
  });

  it('rejects a summary that refers to another capture', () => {
    const manifest = completeManifest();
    manifest.summary.captureId = 'capture-elsewhere';

    expect(CaptureManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it('rejects unknown top-level manifest fields', () => {
    expect(
      CaptureManifestSchema.safeParse({
        ...completeManifest(),
        downloadedCodeIsTrusted: true,
      }).success,
    ).toBe(false);
  });
});

describe('durable recents', () => {
  const recipe = CaptureRecipeSchema.parse({
    url: 'https://example.com/',
    allowHttpFallback: true,
    outputDirectory: '/tmp/sitepull',
    config: {
      maxDepth: 4,
      maxPages: 80,
      viewports: [{ name: 'desktop', width: 1280, height: 800 }],
    },
  });
  const recent = {
    captureId: 'capture-123',
    url: 'https://example.com/',
    hostname: 'example.com',
    capturedAt,
    outputPath: '/tmp/sitepull/example.com-2026-08-30',
    pageCount: 8,
    assetCount: 143,
    byteSize: 14_200_000,
    status: 'completed',
    availability: 'missing',
    recipe,
  } as const;

  it('represents an externally deleted capture without losing history', () => {
    const parsed = RecentCaptureSchema.parse(recent);
    expect(parsed.availability).toBe('missing');
    expect(parsed.recipe).toEqual(recipe);
    expect(parsed.recipe?.config).toMatchObject({
      engine: 'webkit',
      maxDepth: 4,
      maxPages: 80,
      crawlConcurrency: 3,
    });
  });

  it('loads a legacy recent index without inventing a capture recipe', () => {
    const legacyRecent = { ...recent } as Record<string, unknown>;
    delete legacyRecent.recipe;
    const parsed = RecentsIndexSchema.parse({
      schemaVersion: 1,
      updatedAt: capturedAt,
      captures: [legacyRecent],
    });

    expect(parsed.lastUsedRecipe).toBeNull();
    expect(parsed.captures[0]?.recipe).toBeNull();
  });

  it('round-trips the last-used recipe with the complete effective config', () => {
    const parsed = RecentsIndexSchema.parse({
      schemaVersion: 1,
      updatedAt: capturedAt,
      lastUsedRecipe: recipe,
      captures: [recent],
    });

    expect(parsed.lastUsedRecipe).toEqual(recipe);
  });

  it('persists only a credential-free proxy recipe and reads legacy recipes as direct', () => {
    const proxyPool = proxyPoolRecipeFromRequest({
      entries: [
        {
          server: 'https://proxy.example:8443',
          credentials: { username: 'sentinel-user', password: 'sentinel-password' },
        },
      ],
      selection: 'round-robin',
      jitter: { minMs: 25, maxMs: 75 },
    });
    const saved = CaptureRecipeSchema.parse({ ...recipe, proxyPool });
    const serialized = JSON.stringify(saved);

    expect(saved.proxyPool?.entries[0]).toEqual({
      server: 'https://proxy.example:8443',
      authenticationRequired: true,
    });
    expect(serialized).not.toContain('sentinel-user');
    expect(serialized).not.toContain('sentinel-password');
    expect(CaptureRecipeSchema.parse({ ...recipe, proxyPool: undefined }).proxyPool).toBeNull();
  });

  it('rejects duplicate capture records', () => {
    expect(
      RecentsIndexSchema.safeParse({
        schemaVersion: 1,
        updatedAt: capturedAt,
        captures: [recent, recent],
      }).success,
    ).toBe(false);
  });
});
