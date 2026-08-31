// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_CRAWL_CONFIG, type CaptureRecipe, type RecentCapture } from '@sitepull/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { SitepullController } from '../hooks/use-sitepull.js';
import { EmptyState } from './EmptyState.js';

function recipe(hostname = 'example.com'): CaptureRecipe {
  return {
    url: `https://${hostname}/`,
    allowHttpFallback: true,
    outputDirectory: '/tmp/sitepull-repeat',
    config: {
      ...DEFAULT_CRAWL_CONFIG,
      maxDepth: 4,
      maxPages: 60,
      viewports: DEFAULT_CRAWL_CONFIG.viewports.map((viewport) => ({ ...viewport })),
    },
  };
}

function recent(index: number): RecentCapture {
  const hostname = `site-${index}.example.com`;
  return {
    captureId: `capture-${index}`,
    url: `https://${hostname}/`,
    hostname,
    capturedAt: `2026-08-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
    outputPath: `/tmp/sitepull-repeat/capture-${index}`,
    pageCount: index + 1,
    assetCount: index + 10,
    byteSize: 1_024 * (index + 1),
    status: 'completed',
    availability: 'available',
    recipe: recipe(hostname),
  };
}

function makeController(options?: {
  recents?: RecentCapture[];
  lastUsedRecipe?: CaptureRecipe | null;
  draftRecipe?: CaptureRecipe | null;
}) {
  const startCapture = vi.fn(() => Promise.resolve(undefined));
  const openRecent = vi.fn(() => Promise.resolve(undefined));
  const prepareCaptureAgain = vi.fn();
  const controller = {
    model: {
      screen: 'empty',
      recents: options?.recents ?? [],
      recentsLoading: false,
      recentsError: null,
      lastUsedRecipe: options?.lastUsedRecipe ?? null,
      draftRecipe: options?.draftRecipe ?? null,
      viewRecipe: null,
      session: null,
      manifest: null,
      error: null,
      lastRequest: null,
    },
    startCapture,
    openRecent,
    prepareCaptureAgain,
    selectOutputDirectory: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { cancelled: true, path: null },
      }),
    ),
    refreshRecents: vi.fn(() => Promise.resolve(undefined)),
  } as unknown as SitepullController;
  return { controller, startCapture, openRecent, prepareCaptureAgain };
}

describe('EmptyState repeat capture workflow', () => {
  it('preloads and submits the exact persisted recipe, including inferred HTTP fallback', async () => {
    const saved = recipe();
    const { controller, startCapture } = makeController({ lastUsedRecipe: saved });
    render(<EmptyState controller={controller} />);

    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Website URL' }).value).toBe(
      saved.url,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(screen.getByText(saved.outputDirectory)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Pull Site/u }));
    await waitFor(() => expect(startCapture).toHaveBeenCalledTimes(1));
    expect(startCapture).toHaveBeenCalledWith(saved);
  });

  it('searches the full history and exposes Capture Again on every matching recent', () => {
    const recents = Array.from({ length: 12 }, (_, index) => recent(index));
    const { controller, prepareCaptureAgain } = makeController({ recents });
    render(<EmptyState controller={controller} />);

    expect(screen.getAllByRole('button', { name: /Capture site-.* again/u })).toHaveLength(12);
    expect(screen.getByText('12 of 12 captures')).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search capture history' }), {
      target: { value: 'site-11' },
    });

    expect(screen.getByText('1 of 12 captures')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Capture site-11.example.com again' }));
    expect(prepareCaptureAgain).toHaveBeenCalledWith(recents[11]?.recipe);
  });
});
