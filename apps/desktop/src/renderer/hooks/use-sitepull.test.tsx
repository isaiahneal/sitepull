// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import {
  DEFAULT_CRAWL_CONFIG,
  type CaptureEvent,
  type CaptureRecipe,
  type IpcResult,
  type SitepullDesktopApi,
  type SitepullError,
  type StartCaptureResult,
} from '@sitepull/contracts';
import { describe, expect, it, vi } from 'vitest';

import { useSitepull } from './use-sitepull.js';

const bridgeError: SitepullError = {
  name: 'SitepullError',
  code: 'INTERNAL_ERROR',
  message: 'Unavailable in this test.',
  retryable: false,
};

const failure: IpcResult<never> = { ok: false, error: bridgeError };
const success = <T,>(data: T): IpcResult<T> => ({ ok: true, data });
const savedRecipe: CaptureRecipe = {
  url: 'https://example.com/',
  allowHttpFallback: true,
  outputDirectory: '/tmp/sitepull',
  proxyPool: null,
  config: {
    ...DEFAULT_CRAWL_CONFIG,
    maxDepth: 4,
    viewports: DEFAULT_CRAWL_CONFIG.viewports.map((viewport) => ({ ...viewport })),
  },
};

function testApi(startCapture: SitepullDesktopApi['startCapture']): SitepullDesktopApi {
  return {
    startCapture,
    cancelCapture: vi.fn(({ captureId }) =>
      Promise.resolve(success({ captureId, cancellationRequested: true })),
    ),
    getCaptureJob: vi.fn(() => Promise.resolve(success(null))),
    getCapture: vi.fn(() => Promise.resolve(failure)),
    exportCapture: vi.fn(() => Promise.resolve(failure)),
    listRecents: vi.fn(() =>
      Promise.resolve(
        success({
          schemaVersion: 2 as const,
          updatedAt: new Date().toISOString(),
          lastUsedRecipe: savedRecipe,
          captures: [],
        }),
      ),
    ),
    selectOutputDirectory: vi.fn(() => Promise.resolve(success({ cancelled: true, path: null }))),
    readCaptureFile: vi.fn(() => Promise.resolve(failure)),
    openCaptureFolder: vi.fn(() => Promise.resolve(success({ completed: true }))),
    revealCaptureInFinder: vi.fn(() => Promise.resolve(success({ completed: true }))),
    copyAiContext: vi.fn(() => Promise.resolve(success({ completed: true }))),
    onCaptureEvent: () => () => {},
  };
}

describe('useSitepull capture startup', () => {
  it('keeps proxy credentials only in an ephemeral Retry ref and clears them on home', async () => {
    const startCapture = vi.fn((_payload: Parameters<SitepullDesktopApi['startCapture']>[0]) =>
      Promise.resolve(failure),
    );
    Object.defineProperty(window, 'sitepull', {
      configurable: true,
      value: testApi(startCapture),
    });
    const { result, unmount } = renderHook(() => useSitepull());
    await waitFor(() => expect(result.current.model.recentsLoading).toBe(false));

    const request = {
      url: 'https://example.com/',
      config: {
        ...DEFAULT_CRAWL_CONFIG,
        viewports: DEFAULT_CRAWL_CONFIG.viewports.map((viewport) => ({ ...viewport })),
      },
      proxyPool: {
        entries: [
          {
            server: 'http://proxy.example:8080',
            credentials: { username: 'alice', password: 'ephemeral-password' },
          },
        ],
        selection: 'random' as const,
        jitter: { minMs: 10, maxMs: 25 },
      },
    };
    await act(() => result.current.startCapture(request));

    expect(startCapture).toHaveBeenCalledWith(
      expect.objectContaining({ proxyPool: request.proxyPool }),
    );
    expect(JSON.stringify(result.current.model)).not.toContain('ephemeral-password');
    expect(result.current.model.lastRequest?.proxyPool?.entries[0]).toEqual({
      server: 'http://proxy.example:8080',
      authenticationRequired: true,
    });
    expect(result.current.canRetry).toBe(true);

    act(() => result.current.retry());
    await waitFor(() => expect(startCapture).toHaveBeenCalledTimes(2));
    expect(startCapture.mock.calls[1]?.[0].proxyPool?.entries[0]?.credentials?.password).toBe(
      'ephemeral-password',
    );

    act(() => result.current.goHome());
    expect(result.current.canRetry).toBe(false);
    expect(result.current.model.screen).toBe('empty');
    unmount();
  });

  it('adopts and retains a terminal event emitted before startCapture resolves', async () => {
    let listener: ((event: CaptureEvent) => void) | undefined;
    let resolveStart: ((response: IpcResult<StartCaptureResult>) => void) | undefined;
    const pendingStart = new Promise<IpcResult<StartCaptureResult>>((resolve) => {
      resolveStart = resolve;
    });

    const api: SitepullDesktopApi = {
      startCapture: vi.fn(() => pendingStart),
      cancelCapture: vi.fn(({ captureId }) =>
        Promise.resolve(success({ captureId, cancellationRequested: true })),
      ),
      getCaptureJob: vi.fn(() => Promise.resolve(success(null))),
      getCapture: vi.fn(() => Promise.resolve(failure)),
      exportCapture: vi.fn(() => Promise.resolve(failure)),
      listRecents: vi.fn(() =>
        Promise.resolve(
          success({
            schemaVersion: 1 as const,
            updatedAt: new Date().toISOString(),
            lastUsedRecipe: savedRecipe,
            captures: [],
          }),
        ),
      ),
      selectOutputDirectory: vi.fn(() => Promise.resolve(success({ cancelled: true, path: null }))),
      readCaptureFile: vi.fn(() => Promise.resolve(failure)),
      openCaptureFolder: vi.fn(() => Promise.resolve(success({ completed: true }))),
      revealCaptureInFinder: vi.fn(() => Promise.resolve(success({ completed: true }))),
      copyAiContext: vi.fn(() => Promise.resolve(success({ completed: true }))),
      onCaptureEvent: (nextListener) => {
        listener = nextListener;
        return () => {
          listener = undefined;
        };
      },
    };
    Object.defineProperty(window, 'sitepull', { configurable: true, value: api });

    const { result, unmount } = renderHook(() => useSitepull());
    await waitFor(() => expect(listener).toBeDefined());
    await waitFor(() => expect(result.current.model.lastUsedRecipe).toEqual(savedRecipe));

    let startPromise: Promise<void> | undefined;
    act(() => {
      startPromise = result.current.startCapture({
        url: 'https://example.com/',
        config: {
          ...DEFAULT_CRAWL_CONFIG,
          viewports: DEFAULT_CRAWL_CONFIG.viewports.map((viewport) => ({ ...viewport })),
        },
      });
    });

    const earlyError: CaptureEvent = {
      type: 'error',
      captureId: 'capture-fast',
      sequence: 0,
      timestamp: new Date().toISOString(),
      error: {
        name: 'SitepullError',
        code: 'NAVIGATION_TIMEOUT',
        message: 'Navigation timed out.',
        stage: 'rendering',
        retryable: true,
      },
    };
    act(() => listener?.(earlyError));

    await waitFor(() => expect(result.current.model.screen).toBe('error'));
    expect(result.current.model.session?.events).toContainEqual(earlyError);

    await act(async () => {
      resolveStart?.({ ok: true, data: { captureId: 'capture-fast', recipe: savedRecipe } });
      await startPromise;
    });

    expect(result.current.model.screen).toBe('error');
    expect(result.current.model.error?.code).toBe('NAVIGATION_TIMEOUT');
    expect(result.current.model.session?.events).toContainEqual(earlyError);
    expect(result.current.model.viewRecipe).toEqual(savedRecipe);

    act(() => result.current.prepareCaptureAgain(savedRecipe));
    expect(result.current.model.screen).toBe('empty');
    expect(result.current.model.draftRecipe).toEqual(savedRecipe);
    expect(result.current.model.draftRecipe).not.toBe(savedRecipe);
    unmount();
  });

  it('ignores a manifest response after navigation invalidates the load', async () => {
    let resolveCapture:
      ((response: Awaited<ReturnType<SitepullDesktopApi['getCapture']>>) => void) | undefined;
    const pendingCapture = new Promise<Awaited<ReturnType<SitepullDesktopApi['getCapture']>>>(
      (resolve) => {
        resolveCapture = resolve;
      },
    );
    const api: SitepullDesktopApi = {
      startCapture: vi.fn(() => Promise.resolve(failure)),
      cancelCapture: vi.fn(({ captureId }) =>
        Promise.resolve(success({ captureId, cancellationRequested: true })),
      ),
      getCaptureJob: vi.fn(() => Promise.resolve(success(null))),
      getCapture: vi.fn(() => pendingCapture),
      exportCapture: vi.fn(() => Promise.resolve(failure)),
      listRecents: vi.fn(() =>
        Promise.resolve(
          success({
            schemaVersion: 1 as const,
            updatedAt: new Date().toISOString(),
            lastUsedRecipe: null,
            captures: [],
          }),
        ),
      ),
      selectOutputDirectory: vi.fn(() => Promise.resolve(success({ cancelled: true, path: null }))),
      readCaptureFile: vi.fn(() => Promise.resolve(failure)),
      openCaptureFolder: vi.fn(() => Promise.resolve(success({ completed: true }))),
      revealCaptureInFinder: vi.fn(() => Promise.resolve(success({ completed: true }))),
      copyAiContext: vi.fn(() => Promise.resolve(success({ completed: true }))),
      onCaptureEvent: () => () => {},
    };
    Object.defineProperty(window, 'sitepull', { configurable: true, value: api });

    const { result, unmount } = renderHook(() => useSitepull());
    let openPromise: Promise<void> | undefined;
    act(() => {
      openPromise = result.current.openRecent('capture-old');
      result.current.goHome();
    });

    await act(async () => {
      resolveCapture?.(failure);
      await openPromise;
    });

    expect(result.current.model.screen).toBe('empty');
    expect(result.current.model.error).toBeNull();
    unmount();
  });
});
