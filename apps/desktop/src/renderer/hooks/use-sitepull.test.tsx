// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import {
  DEFAULT_CRAWL_CONFIG,
  type CaptureEvent,
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

describe('useSitepull capture startup', () => {
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
      getCapture: vi.fn(() => Promise.resolve(failure)),
      exportCapture: vi.fn(() => Promise.resolve(failure)),
      listRecents: vi.fn(() =>
        Promise.resolve(
          success({
            schemaVersion: 1 as const,
            updatedAt: new Date().toISOString(),
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
      resolveStart?.({ ok: true, data: { captureId: 'capture-fast' } });
      await startPromise;
    });

    expect(result.current.model.screen).toBe('error');
    expect(result.current.model.error?.code).toBe('NAVIGATION_TIMEOUT');
    expect(result.current.model.session?.events).toContainEqual(earlyError);
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
      getCapture: vi.fn(() => pendingCapture),
      exportCapture: vi.fn(() => Promise.resolve(failure)),
      listRecents: vi.fn(() =>
        Promise.resolve(
          success({
            schemaVersion: 1 as const,
            updatedAt: new Date().toISOString(),
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
