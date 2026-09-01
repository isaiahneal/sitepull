// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import {
  DEFAULT_CRAWL_CONFIG,
  type CaptureEvent,
  type CaptureJobSnapshot,
  type CaptureManifest,
  type CaptureRecipe,
  type IpcResult,
  type SitepullDesktopApi,
  type SitepullError,
} from '@sitepull/contracts';
import { describe, expect, it, vi } from 'vitest';

import { useSitepull } from './use-sitepull.js';

const capturedAt = '2026-08-30T12:00:00.000Z';
const recipe: CaptureRecipe = {
  url: 'https://example.com/',
  allowHttpFallback: true,
  outputDirectory: '/tmp/sitepull',
  proxyPool: null,
  config: {
    ...DEFAULT_CRAWL_CONFIG,
    viewports: DEFAULT_CRAWL_CONFIG.viewports.map((viewport) => ({ ...viewport })),
  },
};
const bridgeError: SitepullError = {
  name: 'SitepullError',
  code: 'INTERNAL_ERROR',
  message: 'Unavailable in this test.',
  retryable: false,
};
const failure: IpcResult<never> = { ok: false, error: bridgeError };
const success = <T,>(data: T): IpcResult<T> => ({ ok: true, data });

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve: (value: T) => resolve?.(value) };
}

function progress(captureId: string): CaptureEvent {
  return {
    type: 'progress',
    captureId,
    sequence: 0,
    timestamp: capturedAt,
    stage: 'rendering',
    state: 'progress',
    message: 'Rendering example.com',
    currentUrl: 'https://example.com/',
    elapsedMs: 1_000,
    counters: {
      discoveredPages: 1,
      completedPages: 0,
      assets: 2,
      elements: 10,
      bytesCaptured: 512,
    },
    determinate: null,
  };
}

function terminalError(captureId: string): CaptureEvent {
  return {
    type: 'error',
    captureId,
    sequence: 1,
    timestamp: '2026-08-30T12:00:02.000Z',
    error: {
      name: 'SitepullError',
      code: 'NAVIGATION_TIMEOUT',
      message: 'Navigation timed out.',
      stage: 'rendering',
      retryable: true,
    },
  };
}

function terminalComplete(captureId: string): CaptureEvent {
  return {
    type: 'complete',
    captureId,
    sequence: 1,
    timestamp: '2026-08-30T12:00:03.000Z',
    result: {
      captureId,
      status: 'completed',
      sourceUrl: 'https://example.com/',
      normalizedUrl: 'https://example.com/',
      hostname: 'example.com',
      outputDirectory: `/tmp/sitepull/${captureId}`,
      startedAt: capturedAt,
      completedAt: '2026-08-30T12:00:03.000Z',
      durationMs: 3_000,
      counts: { pages: 1, assets: 2, components: 0, elements: 10, bytes: 512 },
      aiPack: null,
      fullCapture: null,
      error: null,
    },
  };
}

function activeSnapshot(captureId: string): Extract<CaptureJobSnapshot, { state: 'active' }> {
  return {
    state: 'active',
    captureId,
    recipe,
    events: [progress(captureId)],
  };
}

function createApi(overrides: Partial<SitepullDesktopApi> = {}): SitepullDesktopApi {
  return {
    startCapture: vi.fn(() => Promise.resolve(failure)),
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
          updatedAt: capturedAt,
          lastUsedRecipe: recipe,
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
    ...overrides,
  };
}

describe('useSitepull owner-job reconciliation', () => {
  it('rehydrates the active owner job and replay when a renderer mounts after reload', async () => {
    const captureId = 'capture-reloaded';
    const cancelCapture = vi.fn(({ captureId: requestedId }: { captureId: string }) =>
      Promise.resolve(success({ captureId: requestedId, cancellationRequested: true })),
    );
    const api = createApi({
      getCaptureJob: vi.fn(() => Promise.resolve(success(activeSnapshot(captureId)))),
      cancelCapture,
    });
    Object.defineProperty(window, 'sitepull', { configurable: true, value: api });

    const { result, unmount } = renderHook(() => useSitepull());

    await waitFor(() => expect(result.current.model.screen).toBe('capturing'));
    expect(result.current.model.session?.events).toEqual([progress(captureId)]);
    expect(result.current.model.lastRequest).toEqual(recipe);
    await act(() => result.current.cancelCapture());
    expect(cancelCapture).toHaveBeenCalledWith({ captureId });
    unmount();
  });

  it('recovers a missed terminal event from the owner snapshot when the window regains focus', async () => {
    const captureId = 'capture-dropped-terminal';
    let requestCount = 0;
    const active = activeSnapshot(captureId);
    const terminal: CaptureJobSnapshot = {
      ...active,
      state: 'terminal',
      events: [...active.events, terminalError(captureId)],
    };
    const api = createApi({
      getCaptureJob: vi.fn(() =>
        Promise.resolve(success(requestCount++ === 0 ? active : terminal)),
      ),
    });
    Object.defineProperty(window, 'sitepull', { configurable: true, value: api });

    const { result, unmount } = renderHook(() => useSitepull());
    await waitFor(() => expect(result.current.model.screen).toBe('capturing'));

    await act(() => window.dispatchEvent(new Event('focus')));

    await waitFor(() => expect(result.current.model.screen).toBe('error'));
    expect(result.current.model.error?.code).toBe('NAVIGATION_TIMEOUT');
    expect(result.current.model.session?.events.map((event) => event.sequence)).toEqual([0, 1]);
    unmount();
  });

  it('merges a completion delivered while the initial snapshot request is in flight', async () => {
    const captureId = 'capture-completion-race';
    const snapshotRequest = deferred<IpcResult<CaptureJobSnapshot | null>>();
    let listener: ((event: CaptureEvent) => void) | undefined;
    const completedManifest = {
      captureId,
      status: 'completed',
      summary: { error: null },
    } as unknown as CaptureManifest;
    const getCapture = vi.fn(() => Promise.resolve(success(completedManifest)));
    const api = createApi({
      getCaptureJob: vi.fn(() => snapshotRequest.promise),
      getCapture,
      onCaptureEvent: (nextListener) => {
        listener = nextListener;
        return () => {
          listener = undefined;
        };
      },
    });
    Object.defineProperty(window, 'sitepull', { configurable: true, value: api });

    const { result, unmount } = renderHook(() => useSitepull());
    await waitFor(() => expect(listener).toBeDefined());
    act(() => listener?.(terminalComplete(captureId)));
    await act(async () => {
      snapshotRequest.resolve(success(activeSnapshot(captureId)));
      await snapshotRequest.promise;
    });

    await waitFor(() => expect(result.current.model.screen).toBe('results'));
    expect(getCapture).toHaveBeenCalledWith({ captureId });
    expect(result.current.model.session?.events.map((event) => event.type)).toEqual([
      'progress',
      'complete',
    ]);
    unmount();
  });

  it('does not let an in-flight active snapshot overwrite a live terminal error', async () => {
    const captureId = 'capture-stale-active';
    const staleSnapshot = deferred<IpcResult<CaptureJobSnapshot | null>>();
    const active = activeSnapshot(captureId);
    let requestCount = 0;
    let listener: ((event: CaptureEvent) => void) | undefined;
    const getCaptureJob = vi.fn(() => {
      requestCount += 1;
      return requestCount === 1 ? Promise.resolve(success(active)) : staleSnapshot.promise;
    });
    const api = createApi({
      getCaptureJob,
      onCaptureEvent: (nextListener) => {
        listener = nextListener;
        return () => {
          listener = undefined;
        };
      },
    });
    Object.defineProperty(window, 'sitepull', { configurable: true, value: api });

    const { result, unmount } = renderHook(() => useSitepull());
    await waitFor(() => expect(result.current.model.screen).toBe('capturing'));

    await act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(getCaptureJob).toHaveBeenCalledTimes(2));
    act(() => listener?.(terminalError(captureId)));
    await waitFor(() => expect(result.current.model.screen).toBe('error'));

    await act(async () => {
      staleSnapshot.resolve(success(active));
      await staleSnapshot.promise;
    });

    expect(result.current.model.screen).toBe('error');
    expect(result.current.model.error?.code).toBe('NAVIGATION_TIMEOUT');
    unmount();
  });

  it('does not replay a prior terminal snapshot after a new capture is rejected before start', async () => {
    const priorCaptureId = 'capture-prior-terminal';
    const priorActive = activeSnapshot(priorCaptureId);
    const priorTerminal: CaptureJobSnapshot = {
      ...priorActive,
      state: 'terminal',
      events: [...priorActive.events, terminalError(priorCaptureId)],
    };
    const outputError: SitepullError = {
      name: 'SitepullError',
      code: 'OUTPUT_NOT_WRITABLE',
      message: 'The saved output folder is no longer available.',
      stage: 'validation',
      retryable: false,
    };
    const outputFailure: IpcResult<never> = { ok: false, error: outputError };
    const getCaptureJob = vi.fn(() => Promise.resolve(success(priorTerminal)));
    const api = createApi({
      getCaptureJob,
      startCapture: vi.fn(() => Promise.resolve(outputFailure)),
    });
    Object.defineProperty(window, 'sitepull', { configurable: true, value: api });

    const { result, unmount } = renderHook(() => useSitepull());
    await waitFor(() => expect(result.current.model.error?.code).toBe('NAVIGATION_TIMEOUT'));

    await act(() =>
      result.current.startCapture({
        url: recipe.url,
        allowHttpFallback: recipe.allowHttpFallback,
        outputDirectory: recipe.outputDirectory,
        config: recipe.config,
      }),
    );
    await waitFor(() => expect(result.current.model.error?.code).toBe('OUTPUT_NOT_WRITABLE'));

    await act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(getCaptureJob).toHaveBeenCalledTimes(2));
    expect(result.current.model.error?.code).toBe('OUTPUT_NOT_WRITABLE');
    expect(result.current.model.error?.message).toBe(
      'The saved output folder is no longer available.',
    );
    unmount();
  });
});
