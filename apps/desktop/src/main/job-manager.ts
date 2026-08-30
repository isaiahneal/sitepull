import type { WebContents } from 'electron';
import {
  CaptureEventSchema,
  StartCaptureResultSchema,
  SITEPULL_IPC_CHANNELS,
  type CaptureCompleteEvent,
  type CaptureEvent,
  type StartCapturePayload,
  type StartCaptureResult,
} from '@sitepull/contracts';
import type { CaptureRunResult } from '@sitepull/core';

import type { CaptureRegistry } from './capture-registry.js';
import { loadCore } from './core.js';
import { DesktopError, toIpcFailure } from './errors.js';
import type { RecentsStore } from './recents-store.js';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

interface CaptureJob {
  readonly controller: AbortController;
  readonly owner: WebContents;
  captureId: string | null;
  completeEvent: CaptureCompleteEvent | null;
}

function deferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    promise,
    resolve(value) {
      resolve?.(value);
    },
    reject(reason) {
      reject?.(reason);
    },
  };
}

export class CaptureJobManager {
  readonly #registry: CaptureRegistry;
  readonly #recents: RecentsStore;
  readonly #active = new Map<string, CaptureJob>();
  readonly #starting = new Set<CaptureJob>();
  readonly #settlements = new Set<Promise<void>>();

  constructor(registry: CaptureRegistry, recents: RecentsStore) {
    this.#registry = registry;
    this.#recents = recents;
  }

  get hasActiveJobs(): boolean {
    return this.#active.size > 0 || this.#starting.size > 0;
  }

  async start(
    payload: StartCapturePayload,
    outputDirectory: string,
    owner: WebContents,
  ): Promise<StartCaptureResult> {
    if (this.hasActiveJobs) {
      throw new DesktopError({
        code: 'CRAWL_FAILED',
        message: 'A Sitepull capture is already running.',
        stage: 'validation',
        retryable: true,
      });
    }

    const firstEvent = deferred<string>();
    const job: CaptureJob = {
      controller: new AbortController(),
      owner,
      captureId: null,
      completeEvent: null,
    };
    this.#starting.add(job);
    let runPromise: Promise<CaptureRunResult>;
    try {
      const { runCapture } = await loadCore();
      runPromise = runCapture(
        {
          url: payload.url,
          outputDirectory,
          ...(payload.allowHttpFallback === undefined
            ? {}
            : { allowHttpFallback: payload.allowHttpFallback }),
          ...(payload.config === undefined ? {} : { config: payload.config }),
        },
        {
          signal: job.controller.signal,
          onEvent: (event) => {
            const parsedEvent = CaptureEventSchema.parse(event);
            if (job.captureId === null) {
              job.captureId = parsedEvent.captureId;
              this.#starting.delete(job);
              this.#active.set(parsedEvent.captureId, job);
              firstEvent.resolve(parsedEvent.captureId);
            }
            if (parsedEvent.type === 'complete') job.completeEvent = parsedEvent;
            else this.#send(job, parsedEvent);
          },
        },
      );
    } catch (error) {
      this.#starting.delete(job);
      throw error;
    }

    const settlement = this.#settle(job, runPromise, firstEvent);
    this.#settlements.add(settlement);
    void settlement.then(
      () => this.#settlements.delete(settlement),
      () => this.#settlements.delete(settlement),
    );

    return StartCaptureResultSchema.parse({ captureId: await firstEvent.promise });
  }

  cancel(captureId: string, ownerId: number): boolean {
    const job = this.#active.get(captureId);
    if (job === undefined || job.owner.id !== ownerId || job.controller.signal.aborted)
      return false;
    job.controller.abort();
    return true;
  }

  abortForOwner(ownerId: number): void {
    for (const job of [...this.#active.values(), ...this.#starting]) {
      if (job.owner.id === ownerId) job.controller.abort();
    }
  }

  abortAll(): void {
    for (const job of [...this.#active.values(), ...this.#starting]) job.controller.abort();
  }

  async whenIdle(): Promise<void> {
    await Promise.allSettled([...this.#settlements]);
  }

  async #settle(
    job: CaptureJob,
    runPromise: Promise<CaptureRunResult>,
    firstEvent: Deferred<string>,
  ): Promise<void> {
    try {
      const result = await runPromise;
      await this.#registry.registerCompleted(
        result.summary.captureId,
        result.outputDirectory,
        result.manifest,
      );
      const { directoryByteSize } = await loadCore();
      let byteSize = result.summary.counts.bytes;
      try {
        byteSize = await directoryByteSize(result.outputDirectory);
      } catch {
        // Asset bytes are still a deterministic lower-bound if size enumeration fails.
      }
      try {
        await this.#recents.upsert({
          captureId: result.summary.captureId,
          url: result.summary.normalizedUrl,
          hostname: result.summary.hostname,
          capturedAt: result.summary.completedAt ?? new Date().toISOString(),
          outputPath: result.outputDirectory,
          pageCount: result.summary.counts.pages,
          assetCount: result.summary.counts.assets,
          byteSize,
          status: result.summary.status,
          availability: 'available',
        });
      } catch (error) {
        console.error('Could not persist Sitepull recent capture:', error);
      }
      if (job.completeEvent !== null) this.#send(job, job.completeEvent);
    } catch (error) {
      firstEvent.reject(error);
      if (job.captureId !== null && job.completeEvent !== null) {
        this.#send(
          job,
          CaptureEventSchema.parse({
            type: 'error',
            captureId: job.captureId,
            sequence: job.completeEvent.sequence,
            timestamp: new Date().toISOString(),
            error: toIpcFailure(error, 'The completed capture could not be registered.').error,
          }),
        );
      }
    } finally {
      this.#starting.delete(job);
      if (job.captureId !== null) this.#active.delete(job.captureId);
    }
  }

  #send(job: CaptureJob, event: CaptureEvent): void {
    if (job.owner.isDestroyed()) return;
    try {
      job.owner.send(SITEPULL_IPC_CHANNELS.captureEvent, CaptureEventSchema.parse(event));
    } catch {
      // Closing the initiating renderer must never invalidate or redirect a core job.
    }
  }
}
