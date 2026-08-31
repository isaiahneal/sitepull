import type { PageCaptureAttempt } from '@sitepull/contracts';

import { abortableDelay, throwIfAborted } from './async.js';
import { asSitepullError, SitepullError } from './errors.js';

export const MAX_PAGE_CAPTURE_ATTEMPTS = 3;
export const MAX_PAGE_RETRY_DELAY_MS = 10_000;
const BASE_PAGE_RETRY_DELAY_MS = 250;

export function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

/** Client responses that are terminal capture failures rather than retry candidates. */
export function isNonRetryableHttpClientError(status: number): boolean {
  return status >= 400 && status <= 499 && !isRetryableHttpStatus(status);
}

/** Parses Retry-After delay-seconds or an HTTP date, bounded to a practical crawl delay. */
export function parseRetryAfterMs(value: string | undefined, nowMs = Date.now()): number | null {
  const normalized = value?.trim();
  if (normalized === undefined || normalized === '') return null;

  if (/^\d+$/u.test(normalized)) {
    const seconds = Number.parseInt(normalized, 10);
    if (!Number.isFinite(seconds)) return null;
    return Math.min(seconds * 1_000, MAX_PAGE_RETRY_DELAY_MS);
  }

  const dateMs = Date.parse(normalized);
  if (!Number.isFinite(dateMs)) return null;
  return Math.min(Math.max(0, dateMs - nowMs), MAX_PAGE_RETRY_DELAY_MS);
}

function numericErrorDetail(error: SitepullError, name: string): number | null {
  const value = error.details?.[name];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function retryDelayMs(error: SitepullError, attempt: number): number {
  const requested = numericErrorDetail(error, 'retryAfterMs');
  if (requested !== null) return Math.min(Math.round(requested), MAX_PAGE_RETRY_DELAY_MS);
  return Math.min(BASE_PAGE_RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_PAGE_RETRY_DELAY_MS);
}

function httpStatus(error: SitepullError): number | null {
  const status = numericErrorDetail(error, 'status');
  return status !== null && Number.isInteger(status) && status <= 599 ? status : null;
}

export type PageRetryResult<Value> =
  | { readonly ok: true; readonly value: Value; readonly attempts: readonly PageCaptureAttempt[] }
  | {
      readonly ok: false;
      readonly error: SitepullError;
      readonly attempts: readonly PageCaptureAttempt[];
    };

export interface PageRetryOptions<Value> {
  readonly signal?: AbortSignal;
  readonly maxAttempts?: number;
  readonly getHttpStatus?: (value: Value) => number | null;
  readonly onRetry?: (attempt: PageCaptureAttempt) => void | Promise<void>;
}

/** Runs isolated page attempts with deterministic, abortable exponential backoff. */
export async function captureWithPageRetries<Value>(
  operation: (attempt: number) => Promise<Value>,
  options: PageRetryOptions<Value> = {},
): Promise<PageRetryResult<Value>> {
  const maxAttempts = options.maxAttempts ?? MAX_PAGE_CAPTURE_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new RangeError('maxAttempts must be an integer from 1 to 10.');
  }

  const attempts: PageCaptureAttempt[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(options.signal);
    const startedAt = new Date();
    const startedMs = Date.now();
    try {
      const value = await operation(attempt);
      attempts.push({
        attempt,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - startedMs),
        outcome: 'captured',
        httpStatus: options.getHttpStatus?.(value) ?? null,
      });
      return { ok: true, value, attempts };
    } catch (cause) {
      if (options.signal?.aborted === true) throwIfAborted(options.signal);
      const error = asSitepullError(cause, {
        code: 'CRAWL_FAILED',
        stage: 'crawling-pages',
        retryable: true,
        message: cause instanceof Error ? cause.message : 'The page capture attempt failed.',
      });
      if (error.code === 'CAPTURE_CANCELLED') throw error;

      const canRetry = error.retryable && attempt < maxAttempts;
      const delay = canRetry ? retryDelayMs(error, attempt) : undefined;
      const evidence: PageCaptureAttempt = {
        attempt,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - startedMs),
        outcome: canRetry ? 'retrying' : 'failed',
        httpStatus: httpStatus(error),
        ...(delay === undefined ? {} : { retryDelayMs: delay }),
        error: error.toJSON(),
      };
      attempts.push(evidence);

      if (!canRetry || delay === undefined) return { ok: false, error, attempts };
      await options.onRetry?.(evidence);
      await abortableDelay(delay, options.signal);
    }
  }

  throw new SitepullError({
    code: 'INTERNAL_ERROR',
    message: 'The page retry loop ended without a result.',
    stage: 'crawling-pages',
  });
}
