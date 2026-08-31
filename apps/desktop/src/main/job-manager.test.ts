import type { WebContents } from 'electron';
import {
  CAPTURE_EVENT_REPLAY_LIMIT,
  DEFAULT_CRAWL_CONFIG,
  SITEPULL_IPC_CHANNELS,
  type CaptureEvent,
  type CaptureResultSummary,
} from '@sitepull/contracts';
import type { CaptureRunResult, RunCaptureOptions } from '@sitepull/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CaptureRegistry } from './capture-registry.js';
import { CaptureJobManager } from './job-manager.js';
import type { RecentsStore } from './recents-store.js';

const core = vi.hoisted(() => ({
  runCapture: vi.fn(),
  directoryByteSize: vi.fn(() => Promise.resolve(2_048)),
}));

vi.mock('./core.js', () => ({
  loadCore: () => Promise.resolve(core),
}));

const startedAt = '2026-08-30T12:00:00.000Z';
const completedAt = '2026-08-30T12:00:05.000Z';

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((reason: Error) => void) | undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    promise,
    resolve: (value: T) => resolve?.(value),
    reject: (reason: Error) => reject?.(reason),
  };
}

function owner(id: number) {
  const send = vi.fn();
  return {
    webContents: {
      id,
      isDestroyed: () => false,
      send,
    } as unknown as WebContents,
    send,
  };
}

function summary(captureId: string): CaptureResultSummary {
  return {
    captureId,
    status: 'completed',
    sourceUrl: 'https://example.com/',
    normalizedUrl: 'https://example.com/',
    hostname: 'example.com',
    outputDirectory: `/tmp/sitepull/${captureId}`,
    startedAt,
    completedAt,
    durationMs: 5_000,
    counts: { pages: 1, assets: 2, components: 0, elements: 10, bytes: 1_024 },
    aiPack: null,
    fullCapture: null,
    error: null,
  };
}

function runResult(captureId: string): CaptureRunResult {
  return {
    outputDirectory: `/tmp/sitepull/${captureId}`,
    summary: summary(captureId),
    manifest: {} as CaptureRunResult['manifest'],
  };
}

function services(registerCompleted = vi.fn(() => Promise.resolve())) {
  const registry = { registerCompleted } as unknown as CaptureRegistry;
  const recents = {
    rememberRecipe: vi.fn(() => Promise.resolve()),
    upsert: vi.fn(() => Promise.resolve()),
  } as unknown as RecentsStore;
  return { registry, recents };
}

function logEvent(captureId: string, sequence: number): CaptureEvent {
  return {
    type: 'log',
    captureId,
    sequence,
    timestamp: new Date(Date.parse(startedAt) + sequence).toISOString(),
    level: 'info',
    stage: 'rendering',
    message: `Event ${sequence}`,
  };
}

describe('CaptureJobManager owner reconciliation', () => {
  beforeEach(() => {
    core.runCapture.mockReset();
    core.directoryByteSize.mockClear();
  });

  it('retains a bounded monotonic replay only for the renderer that owns the job', async () => {
    const captureId = 'capture-replay';
    const run = deferred<CaptureRunResult>();
    core.runCapture.mockImplementation((_input: unknown, options: RunCaptureOptions) => {
      for (let sequence = 0; sequence < CAPTURE_EVENT_REPLAY_LIMIT + 5; sequence += 1) {
        options.onEvent?.(logEvent(captureId, sequence));
      }
      return run.promise;
    });
    const { registry, recents } = services();
    const manager = new CaptureJobManager(registry, recents);
    const renderer = owner(41);

    await manager.start(
      { url: 'https://example.com/', config: DEFAULT_CRAWL_CONFIG },
      '/tmp/sitepull',
      renderer.webContents,
    );

    const snapshot = manager.snapshotForOwner(renderer.webContents.id);
    expect(snapshot?.state).toBe('active');
    expect(snapshot?.events).toHaveLength(CAPTURE_EVENT_REPLAY_LIMIT);
    expect(snapshot?.events[0]?.sequence).toBe(5);
    expect(snapshot?.events.at(-1)?.sequence).toBe(CAPTURE_EVENT_REPLAY_LIMIT + 4);
    expect(manager.snapshotForOwner(99)).toBeNull();

    run.reject(new Error('Fixture capture stopped.'));
    await manager.whenIdle();
    expect(manager.snapshotForOwner(renderer.webContents.id)?.state).toBe('terminal');
  });

  it('never exposes completion before registration and retains it after active cleanup', async () => {
    const captureId = 'capture-complete';
    const registration = deferred<void>();
    const registerCompleted = vi.fn(() => registration.promise);
    const { registry, recents } = services(registerCompleted);
    const manager = new CaptureJobManager(registry, recents);
    const renderer = owner(52);
    core.runCapture.mockImplementation((_input: unknown, options: RunCaptureOptions) => {
      options.onEvent?.(logEvent(captureId, 0));
      options.onEvent?.({
        type: 'complete',
        captureId,
        sequence: 1,
        timestamp: completedAt,
        result: summary(captureId),
      });
      return Promise.resolve(runResult(captureId));
    });

    await manager.start(
      { url: 'https://example.com/', config: DEFAULT_CRAWL_CONFIG },
      '/tmp/sitepull',
      renderer.webContents,
    );
    await vi.waitFor(() => expect(registerCompleted).toHaveBeenCalledTimes(1));

    const registering = manager.snapshotForOwner(renderer.webContents.id);
    expect(registering?.state).toBe('active');
    expect(registering?.events.map((event) => event.type)).toEqual(['log']);
    expect(renderer.send).toHaveBeenCalledTimes(1);

    registration.resolve(undefined);
    await manager.whenIdle();

    const terminal = manager.snapshotForOwner(renderer.webContents.id);
    expect(terminal?.state).toBe('terminal');
    expect(terminal?.events.map((event) => event.type)).toEqual(['log', 'complete']);
    expect(renderer.send).toHaveBeenLastCalledWith(
      SITEPULL_IPC_CHANNELS.captureEvent,
      expect.objectContaining({ type: 'complete', captureId }),
    );
    expect(manager.snapshotForOwner(53)).toBeNull();
  });
});
