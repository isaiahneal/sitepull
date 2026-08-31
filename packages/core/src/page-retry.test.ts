import { describe, expect, it } from 'vitest';
import { PageCaptureAttemptSchema } from '@sitepull/contracts';

import { MAX_SITEPULL_ERROR_MESSAGE_LENGTH, SitepullError } from './errors.js';
import {
  captureWithPageRetries,
  isNonRetryableHttpClientError,
  isRetryableHttpStatus,
  MAX_PAGE_RETRY_DELAY_MS,
  parseRetryAfterMs,
} from './page-retry.js';

function retryableStatusError(status: number, retryAfterMs?: number): SitepullError {
  return new SitepullError({
    code: 'HTTP_RETRYABLE_STATUS',
    message: `HTTP ${status}`,
    stage: 'rendering',
    retryable: true,
    details: { status, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) },
  });
}

describe('page capture retry policy', () => {
  it('classifies only the bounded transient HTTP status set', () => {
    for (const status of [408, 425, 429, 500, 503, 599]) {
      expect(isRetryableHttpStatus(status)).toBe(true);
    }
    for (const status of [200, 301, 400, 401, 403, 404, 600]) {
      expect(isRetryableHttpStatus(status)).toBe(false);
    }
  });

  it('classifies terminal client responses without treating redirects or transient statuses as terminal', () => {
    for (const status of [400, 401, 403, 404, 405, 410, 451]) {
      expect(isNonRetryableHttpClientError(status)).toBe(true);
    }
    for (const status of [200, 301, 408, 425, 429, 500]) {
      expect(isNonRetryableHttpClientError(status)).toBe(false);
    }
  });

  it('parses both Retry-After forms and caps hostile delays', () => {
    expect(parseRetryAfterMs('1', 0)).toBe(1_000);
    expect(
      parseRetryAfterMs('Wed, 21 Oct 2015 07:28:01 GMT', Date.UTC(2015, 9, 21, 7, 28, 0)),
    ).toBe(1_000);
    expect(parseRetryAfterMs('999999')).toBe(MAX_PAGE_RETRY_DELAY_MS);
    expect(parseRetryAfterMs('not-a-delay')).toBeNull();
  });

  it('records a recovered fail-once attempt', async () => {
    let calls = 0;
    const result = await captureWithPageRetries(
      () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(retryableStatusError(503, 0))
          : Promise.resolve({ status: 200 });
      },
      { getHttpStatus: (value) => value.status },
    );

    expect(result).toMatchObject({
      ok: true,
      attempts: [
        { attempt: 1, outcome: 'retrying', httpStatus: 503, retryDelayMs: 0 },
        { attempt: 2, outcome: 'captured', httpStatus: 200 },
      ],
    });
  });

  it('records exhaustion after three permanent failures', async () => {
    const result = await captureWithPageRetries(() => Promise.reject(retryableStatusError(503, 0)));

    expect(result.ok).toBe(false);
    expect(result.attempts.map(({ outcome }) => outcome)).toEqual([
      'retrying',
      'retrying',
      'failed',
    ]);
    expect(result.attempts.map(({ httpStatus }) => httpStatus)).toEqual([503, 503, 503]);
  });

  it('keeps oversized browser diagnostics contract-safe when a retry recovers', async () => {
    const diagnostic = `browser target closed\n${'browser log line\n'.repeat(1_000)}`;
    let calls = 0;
    const result = await captureWithPageRetries(
      () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(
              new SitepullError({
                code: 'CRAWL_FAILED',
                message: diagnostic,
                retryable: true,
                details: { retryAfterMs: 0 },
              }),
            )
          : Promise.resolve({ status: 200 });
      },
      { getHttpStatus: (value) => value.status },
    );

    expect(result.ok).toBe(true);
    expect(result.attempts.map((attempt) => PageCaptureAttemptSchema.parse(attempt))).toHaveLength(
      2,
    );
    expect(result.attempts[0]?.error?.message).toHaveLength(MAX_SITEPULL_ERROR_MESSAGE_LENGTH);
  });

  it('preserves the full terminal error while bounding its attempt evidence', async () => {
    const diagnostic = `browser target closed\n${'browser log line\n'.repeat(1_000)}`;
    const error = new SitepullError({
      code: 'CRAWL_FAILED',
      message: diagnostic,
      retryable: false,
    });
    const result = await captureWithPageRetries(() => Promise.reject(error));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected a terminal page retry result.');
    expect(result.error.message).toBe(diagnostic);
    expect(PageCaptureAttemptSchema.parse(result.attempts[0])).toEqual(result.attempts[0]);
    expect(result.attempts[0]?.error?.message).toHaveLength(MAX_SITEPULL_ERROR_MESSAGE_LENGTH);
  });

  it('cancels promptly while waiting in Retry-After backoff', async () => {
    const controller = new AbortController();
    let calls = 0;
    const startedAt = Date.now();
    const pending = captureWithPageRetries(
      () => {
        calls += 1;
        return Promise.reject(retryableStatusError(429, 5_000));
      },
      {
        signal: controller.signal,
        onRetry: () => {
          setTimeout(() => controller.abort('test cancellation'), 10);
        },
      },
    );

    await expect(pending).rejects.toMatchObject({ code: 'CAPTURE_CANCELLED' });
    expect(calls).toBe(1);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
