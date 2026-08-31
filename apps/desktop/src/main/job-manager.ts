import type { WebContents } from 'electron';
import {
  CAPTURE_EVENT_REPLAY_LIMIT,
  CaptureRecipeSchema,
  CaptureEventSchema,
  CaptureJobSnapshotSchema,
  StartCaptureResultSchema,
  SITEPULL_IPC_CHANNELS,
  type CaptureCompleteEvent,
  type CaptureEvent,
  type CaptureJobSnapshot,
  type CaptureRecipe,
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
  readonly recipe: CaptureRecipe;
  readonly events: CaptureEvent[];
  captureId: string | null;
  completeEvent: CaptureCompleteEvent | null;
  detached: boolean;
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
  readonly #latestTerminalByOwner = new Map<number, CaptureJobSnapshot>();

  constructor(registry: CaptureRegistry, recents: RecentsStore) {
    this.#registry = registry;
    this.#recents = recents;
  }

  get hasActiveJobs(): boolean {
    return this.#active.size > 0 || this.#starting.size > 0;
  }

  snapshotForOwner(ownerId: number): CaptureJobSnapshot | null {
    for (const job of this.#starting) {
      if (job.owner.id === ownerId) return this.#snapshot(job);
    }
    for (const job of this.#active.values()) {
      if (job.owner.id === ownerId) return this.#snapshot(job);
    }
    const terminal = this.#latestTerminalByOwner.get(ownerId);
    return terminal === undefined ? null : CaptureJobSnapshotSchema.parse(terminal);
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

    const recipe = CaptureRecipeSchema.parse({
      url: payload.url,
      allowHttpFallback: payload.allowHttpFallback ?? false,
      outputDirectory,
      config: payload.config ?? {},
    });
    this.#latestTerminalByOwner.delete(owner.id);
    const firstEvent = deferred<string>();
    const job: CaptureJob = {
      controller: new AbortController(),
      owner,
      recipe,
      events: [],
      captureId: null,
      completeEvent: null,
      detached: false,
    };
    this.#starting.add(job);
    try {
      await this.#recents.rememberRecipe(recipe);
    } catch (error) {
      console.error('Could not persist the last-used Sitepull recipe:', error);
    }

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
            } else if (parsedEvent.captureId !== job.captureId) {
              throw new DesktopError({
                code: 'INTERNAL_ERROR',
                message: 'The capture engine emitted a mismatched capture identifier.',
                stage: 'validation',
              });
            }
            if (parsedEvent.type === 'complete') job.completeEvent = parsedEvent;
            else this.#publish(job, parsedEvent);
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

    return StartCaptureResultSchema.parse({ captureId: await firstEvent.promise, recipe });
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
      if (job.owner.id === ownerId) {
        job.detached = true;
        job.controller.abort();
      }
    }
    this.#latestTerminalByOwner.delete(ownerId);
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
          recipe: job.recipe,
        });
      } catch (error) {
        console.error('Could not persist Sitepull recent capture:', error);
      }
      this.#publish(
        job,
        job.completeEvent ??
          CaptureEventSchema.parse({
            type: 'complete',
            captureId: result.summary.captureId,
            sequence: this.#nextSequence(job),
            timestamp: new Date().toISOString(),
            result: result.summary,
          }),
      );
    } catch (error) {
      firstEvent.reject(error);
      if (job.captureId !== null && !this.#hasTerminalEvent(job)) {
        this.#publish(
          job,
          CaptureEventSchema.parse({
            type: 'error',
            captureId: job.captureId,
            sequence: job.completeEvent?.sequence ?? this.#nextSequence(job),
            timestamp: new Date().toISOString(),
            error: toIpcFailure(error, 'The completed capture could not be registered.').error,
          }),
        );
      }
    } finally {
      this.#starting.delete(job);
      if (job.captureId !== null) {
        const snapshot = this.#snapshot(job);
        if (snapshot.state === 'terminal' && !job.detached && !job.owner.isDestroyed()) {
          this.#latestTerminalByOwner.set(job.owner.id, snapshot);
        }
        this.#active.delete(job.captureId);
      }
    }
  }

  #snapshot(job: CaptureJob): CaptureJobSnapshot {
    if (job.captureId === null) {
      return CaptureJobSnapshotSchema.parse({
        state: 'starting',
        captureId: null,
        recipe: job.recipe,
        events: [],
      });
    }
    return CaptureJobSnapshotSchema.parse({
      state: this.#hasTerminalEvent(job) ? 'terminal' : 'active',
      captureId: job.captureId,
      recipe: job.recipe,
      events: job.events,
    });
  }

  #publish(job: CaptureJob, event: CaptureEvent): void {
    const lastEvent = job.events.at(-1);
    if (lastEvent?.type === 'complete' || lastEvent?.type === 'error') return;
    if (lastEvent !== undefined && event.sequence <= lastEvent.sequence) return;

    job.events.push(CaptureEventSchema.parse(event));
    if (job.events.length > CAPTURE_EVENT_REPLAY_LIMIT) {
      job.events.splice(0, job.events.length - CAPTURE_EVENT_REPLAY_LIMIT);
    }
    this.#send(job, event);
  }

  #hasTerminalEvent(job: CaptureJob): boolean {
    const event = job.events.at(-1);
    return event?.type === 'complete' || event?.type === 'error';
  }

  #nextSequence(job: CaptureJob): number {
    return (job.events.at(-1)?.sequence ?? -1) + 1;
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
