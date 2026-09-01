// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_CRAWL_CONFIG, type CaptureRecipe, type RecentCapture } from '@sitepull/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SitepullController } from '../hooks/use-sitepull.js';
import { USER_AGENT_PRESETS } from '../lib/user-agent-presets.js';
import type { StartCaptureOptions } from '../types.js';
import { EmptyState } from './EmptyState.js';

afterEach(cleanup);

function recipe(hostname = 'example.com'): CaptureRecipe {
  return {
    url: `https://${hostname}/`,
    allowHttpFallback: true,
    outputDirectory: '/tmp/sitepull-repeat',
    proxyPool: null,
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
  const startCapture = vi.fn((_options: StartCaptureOptions) => Promise.resolve(undefined));
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
    expect(startCapture).toHaveBeenCalledWith({
      url: saved.url,
      allowHttpFallback: saved.allowHttpFallback,
      outputDirectory: saved.outputDirectory,
      config: saved.config,
    });
  });

  it('submits a UA preset and authenticated multi-proxy routing without placing secrets in recipes', async () => {
    const { controller, startCapture } = makeController();
    render(<EmptyState controller={controller} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Website URL' }), {
      target: { value: 'example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'User-Agent preset' }), {
      target: { value: 'safari-desktop' },
    });
    fireEvent.click(screen.getByRole('switch', { name: /Route through proxies/u }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Proxy 1 server' }), {
      target: { value: 'http://proxy-one.example:8080' },
    });
    fireEvent.click(screen.getByRole('switch', { name: /Basic authentication/u }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Proxy 1 username' }), {
      target: { value: 'alice' },
    });
    fireEvent.change(screen.getByLabelText('Proxy 1 password'), {
      target: { value: 'request-only-secret' },
    });
    expect(screen.getByRole('note').textContent).toMatch(/not encrypted over an HTTP proxy/u);
    fireEvent.click(screen.getByRole('button', { name: 'Add proxy' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Proxy 2 server' }), {
      target: { value: 'https://proxy-two.example:8443' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Proxy selection mode' }), {
      target: { value: 'random' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Minimum jitter (ms)' }), {
      target: { value: '125' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Maximum jitter (ms)' }), {
      target: { value: '450' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Pull Site/u }));
    await waitFor(() => expect(startCapture).toHaveBeenCalledTimes(1));
    expect(startCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          userAgent: USER_AGENT_PRESETS.find((preset) => preset.id === 'safari-desktop')?.value,
        }),
        proxyPool: {
          entries: [
            {
              server: 'http://proxy-one.example:8080',
              credentials: { username: 'alice', password: 'request-only-secret' },
            },
            { server: 'https://proxy-two.example:8443' },
          ],
          selection: 'random',
          jitter: { minMs: 125, maxMs: 450 },
        },
      }),
    );
  });

  it('restores authenticated proxy recipes but requires credentials to be re-entered', async () => {
    const saved = {
      ...recipe(),
      proxyPool: {
        entries: [{ server: 'http://proxy.example:3128', authenticationRequired: true }],
        selection: 'round-robin' as const,
        jitter: { minMs: 0, maxMs: 300 },
      },
    };
    const { controller, startCapture } = makeController({ draftRecipe: saved });
    render(<EmptyState controller={controller} />);

    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Proxy 1 server' }).value).toBe(
      'http://proxy.example:3128',
    );
    expect(screen.getByLabelText<HTMLInputElement>('Proxy 1 password').value).toBe('');
    expect(screen.getByText(/credentials are request-only/iu)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Pull Site/u }));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Re-enter the username and password/u,
    );
    expect(startCapture).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Proxy 1 username' }), {
      target: { value: 'repeat-user' },
    });
    fireEvent.change(screen.getByLabelText('Proxy 1 password'), {
      target: { value: 'fresh-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Pull Site/u }));
    await waitFor(() => expect(startCapture).toHaveBeenCalledTimes(1));
    expect(startCapture.mock.calls[0]?.[0].proxyPool?.entries[0]?.credentials).toEqual({
      username: 'repeat-user',
      password: 'fresh-secret',
    });
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
