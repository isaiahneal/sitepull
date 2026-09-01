// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import {
  CaptureManifestSchema,
  DEFAULT_CRAWL_CONFIG,
  type CaptureRecipe,
} from '@sitepull/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { SitepullController } from '../hooks/use-sitepull.js';
import { ResultWorkspace } from './ResultWorkspace.js';

const capturedAt = '2026-08-30T12:00:00.000Z';

function manifest() {
  return CaptureManifestSchema.parse({
    schemaVersion: 1,
    generatorVersion: '0.1.0',
    captureId: 'capture-repeat',
    status: 'completed',
    source: {
      inputUrl: 'https://example.com/',
      normalizedUrl: 'https://example.com/',
      origin: 'https://example.com/',
      hostname: 'example.com',
    },
    startedAt: capturedAt,
    completedAt: '2026-08-30T12:00:04.000Z',
    config: DEFAULT_CRAWL_CONFIG,
    pages: [],
    resources: [],
    skippedUrls: [],
    design: {
      schemaVersion: 1,
      generatedAt: capturedAt,
      sourcePageCount: 0,
      colors: [],
      typography: [],
      spacing: [],
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
      captureId: 'capture-repeat',
      status: 'completed',
      sourceUrl: 'https://example.com/',
      normalizedUrl: 'https://example.com/',
      hostname: 'example.com',
      outputDirectory: '/tmp/sitepull/capture-repeat',
      startedAt: capturedAt,
      completedAt: '2026-08-30T12:00:04.000Z',
      durationMs: 4_000,
      counts: { pages: 0, assets: 0, components: 0, elements: 0, bytes: 0 },
      aiPack: { estimatedBytes: 1_024, archivePath: null, compressedBytes: null },
      fullCapture: { estimatedBytes: 2_048, archivePath: null, compressedBytes: null },
      error: null,
    },
    errors: [],
  });
}

describe('ResultWorkspace repeat capture action', () => {
  it('preloads the exact recipe associated with the visible result', () => {
    const captureManifest = manifest();
    const savedRecipe: CaptureRecipe = {
      url: 'https://example.com/',
      allowHttpFallback: true,
      outputDirectory: '/tmp/sitepull',
      proxyPool: null,
      config: {
        ...DEFAULT_CRAWL_CONFIG,
        maxPages: 60,
        viewports: DEFAULT_CRAWL_CONFIG.viewports.map((viewport) => ({ ...viewport })),
      },
    };
    const prepareCaptureAgain = vi.fn();
    const controller = {
      model: {
        screen: 'results',
        recents: [],
        recentsLoading: false,
        recentsError: null,
        lastUsedRecipe: savedRecipe,
        draftRecipe: null,
        viewRecipe: savedRecipe,
        session: null,
        manifest: captureManifest,
        error: null,
        lastRequest: null,
      },
      prepareCaptureAgain,
      exportCapture: vi.fn(() => Promise.resolve(null)),
      invokeSystemAction: vi.fn(() => Promise.resolve(null)),
      readCaptureFile: vi.fn(() => Promise.resolve(null)),
    } as unknown as SitepullController;

    render(<ResultWorkspace controller={controller} notify={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Capture Again' }));

    expect(prepareCaptureAgain).toHaveBeenCalledWith(savedRecipe);
  });
});
