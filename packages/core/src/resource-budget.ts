import {
  DEFAULT_MAX_CAPTURE_RESOURCE_BYTES,
  DEFAULT_MAX_RESOURCE_BYTES,
  DEFAULT_RESOURCE_BODY_CONCURRENCY,
} from '@sitepull/contracts';

import { throwIfAborted } from './async.js';

export {
  DEFAULT_MAX_CAPTURE_RESOURCE_BYTES,
  DEFAULT_MAX_RESOURCE_BYTES,
  DEFAULT_RESOURCE_BODY_CONCURRENCY,
} from '@sitepull/contracts';

export interface ResourceCaptureBudgetOptions {
  readonly maxResourceBytes?: number;
  readonly maxCaptureBytes?: number;
  readonly bodyConcurrency?: number;
}

export interface ResourceBodyReadInput {
  readonly declaredBytes: number | null;
  /** Maximum bytes this read may materialize under both per-resource and aggregate limits. */
  readonly read: (maxBytes: number) => Promise<Buffer>;
  readonly signal?: AbortSignal;
}

export interface ResourceBodyReadResult {
  readonly body: Buffer | null;
  readonly failureReason?: string;
}

export interface ResourceBodyReader {
  read(input: ResourceBodyReadInput): Promise<ResourceBodyReadResult>;
}

export interface ResourceCaptureScope extends ResourceBodyReader {
  commit(): void;
  rollback(): void;
}

interface PendingPermit {
  readonly activate: () => void;
  readonly reject: (reason: unknown) => void;
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
}

interface CapacityWaiter {
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function resourceLimitReason(limit: number): string {
  return `Resource exceeds the ${formatByteLimit(limit)} per-resource capture limit.`;
}

function captureLimitReason(limit: number): string {
  return `Capture resource budget of ${formatByteLimit(limit)} is exhausted.`;
}

function formatByteLimit(bytes: number): string {
  if (bytes % (1024 * 1024 * 1024) === 0) return `${bytes / (1024 * 1024 * 1024)} GB`;
  if (bytes % (1024 * 1024) === 0) return `${bytes / (1024 * 1024)} MB`;
  if (bytes % 1024 === 0) return `${bytes / 1024} KB`;
  return `${bytes} bytes`;
}

/**
 * Bounds response-body materialization across every page in one capture.
 *
 * The limiter reserves aggregate capacity before a read and constrains how many
 * bodies may be materialized concurrently. Readers receive an exact byte ceiling
 * so streaming transports can stop before an unknown or dishonest body grows
 * without bound. The returned buffer is checked again before it is committed.
 */
export class ResourceCaptureBudget implements ResourceBodyReader {
  readonly #maxResourceBytes: number;
  readonly #maxCaptureBytes: number;
  readonly #bodyConcurrency: number;
  readonly #pending: PendingPermit[] = [];
  readonly #capacityWaiters: CapacityWaiter[] = [];
  #active = 0;
  #committedBytes = 0;
  #reservedBytes = 0;

  constructor(options: ResourceCaptureBudgetOptions = {}) {
    this.#maxResourceBytes = positiveInteger(
      options.maxResourceBytes ?? DEFAULT_MAX_RESOURCE_BYTES,
      'maxResourceBytes',
    );
    this.#maxCaptureBytes = positiveInteger(
      options.maxCaptureBytes ?? DEFAULT_MAX_CAPTURE_RESOURCE_BYTES,
      'maxCaptureBytes',
    );
    this.#bodyConcurrency = positiveInteger(
      options.bodyConcurrency ?? DEFAULT_RESOURCE_BODY_CONCURRENCY,
      'bodyConcurrency',
    );
  }

  get committedBytes(): number {
    return this.#committedBytes;
  }

  get remainingBytes(): number {
    return Math.max(0, this.#maxCaptureBytes - this.#committedBytes - this.#reservedBytes);
  }

  /**
   * Tracks one retry attempt independently so its body bytes can be released if
   * the page fails after some responses have already been materialized.
   */
  createScope(): ResourceCaptureScope {
    let state: 'active' | 'committed' | 'rolled-back' = 'active';
    let scopedBytes = 0;

    return {
      read: async (input) => {
        if (state !== 'active') {
          throw new TypeError('Resource capture scope is already settled.');
        }
        const result = await this.read(input);
        if (result.body !== null) {
          const stateAfterRead = state as 'active' | 'committed' | 'rolled-back';
          if (stateAfterRead === 'rolled-back') {
            this.#releaseCommitted(result.body.byteLength);
          } else if (stateAfterRead === 'active') {
            scopedBytes += result.body.byteLength;
          }
        }
        return result;
      },
      commit: () => {
        if (state !== 'active') return;
        state = 'committed';
        scopedBytes = 0;
      },
      rollback: () => {
        if (state !== 'active') return;
        state = 'rolled-back';
        this.#releaseCommitted(scopedBytes);
        scopedBytes = 0;
      },
    };
  }

  async read(input: ResourceBodyReadInput): Promise<ResourceBodyReadResult> {
    const declaredBytes =
      input.declaredBytes !== null &&
      Number.isSafeInteger(input.declaredBytes) &&
      input.declaredBytes >= 0
        ? input.declaredBytes
        : null;
    if (declaredBytes !== null && declaredBytes > this.#maxResourceBytes) {
      return { body: null, failureReason: resourceLimitReason(this.#maxResourceBytes) };
    }

    const release = await this.#acquire(input.signal);
    let reservation = 0;
    try {
      while (reservation === 0) {
        throwIfAborted(input.signal);
        const available = this.remainingBytes;
        if (available > 0 && (declaredBytes === null || declaredBytes <= available)) {
          // Reserve the entire readable ceiling, not the declared length. A response
          // can understate Content-Length or expand after content decoding; disjoint
          // reservations keep concurrent materialization within the aggregate cap.
          reservation = Math.min(this.#maxResourceBytes, available);
          this.#reservedBytes += reservation;
          break;
        }

        // Another active reader may have reserved more than it will ultimately
        // consume. Wait for its actual byte count before recording a false gap.
        if (this.#reservedBytes > 0) {
          await this.#waitForCapacityChange(input.signal);
          continue;
        }
        return { body: null, failureReason: captureLimitReason(this.#maxCaptureBytes) };
      }
      const maxReadableBytes = reservation;

      let body: Buffer;
      try {
        body = await input.read(maxReadableBytes);
      } catch (error) {
        throwIfAborted(input.signal);
        return {
          body: null,
          failureReason: error instanceof Error ? error.message : 'Response body was unavailable.',
        };
      }
      throwIfAborted(input.signal);

      if (body.byteLength > this.#maxResourceBytes) {
        return { body: null, failureReason: resourceLimitReason(this.#maxResourceBytes) };
      }
      const capacityAfterOtherReservations =
        this.#maxCaptureBytes - this.#committedBytes - (this.#reservedBytes - reservation);
      if (body.byteLength > capacityAfterOtherReservations) {
        return { body: null, failureReason: captureLimitReason(this.#maxCaptureBytes) };
      }

      this.#committedBytes += body.byteLength;
      return { body };
    } finally {
      this.#reservedBytes -= reservation;
      if (reservation > 0) this.#notifyCapacityChanged();
      release();
    }
  }

  async #acquire(signal?: AbortSignal): Promise<() => void> {
    throwIfAborted(signal);
    if (this.#active < this.#bodyConcurrency) {
      this.#active += 1;
      return this.#releasePermit();
    }

    return new Promise<() => void>((resolve, reject) => {
      const pending: PendingPermit = {
        ...(signal === undefined ? {} : { signal }),
        reject,
        activate: () => resolve(this.#releasePermit()),
      };
      if (signal !== undefined) {
        const onAbort = (): void => {
          signal.removeEventListener('abort', onAbort);
          const index = this.#pending.indexOf(pending);
          if (index >= 0) this.#pending.splice(index, 1);
          try {
            throwIfAborted(signal);
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        };
        Object.assign(pending, { onAbort });
        this.#pending.push(pending);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
        return;
      }
      this.#pending.push(pending);
    });
  }

  #releaseCommitted(bytes: number): void {
    this.#committedBytes = Math.max(0, this.#committedBytes - bytes);
    this.#notifyCapacityChanged();
  }

  #waitForCapacityChange(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    return new Promise<void>((resolve, reject) => {
      const waiter: CapacityWaiter = {
        ...(signal === undefined ? {} : { signal }),
        reject,
        resolve,
      };
      if (signal !== undefined) {
        const onAbort = (): void => {
          signal.removeEventListener('abort', onAbort);
          const index = this.#capacityWaiters.indexOf(waiter);
          if (index >= 0) this.#capacityWaiters.splice(index, 1);
          try {
            throwIfAborted(signal);
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        };
        Object.assign(waiter, { onAbort });
        this.#capacityWaiters.push(waiter);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
        return;
      }
      this.#capacityWaiters.push(waiter);
    });
  }

  #notifyCapacityChanged(): void {
    for (const waiter of this.#capacityWaiters.splice(0)) {
      if (waiter.signal !== undefined && waiter.onAbort !== undefined) {
        waiter.signal.removeEventListener('abort', waiter.onAbort);
      }
      waiter.resolve();
    }
  }

  #releasePermit(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#pending.shift();
      if (next === undefined) {
        this.#active = Math.max(0, this.#active - 1);
        return;
      }
      if (next.signal !== undefined && next.onAbort !== undefined) {
        next.signal.removeEventListener('abort', next.onAbort);
      }
      next.activate();
    };
  }
}
