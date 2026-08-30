import { describe, expect, it } from 'vitest';

import {
  SerializedSitepullErrorSchema,
  SitepullError,
  asSitepullError,
  isSitepullError,
} from './errors.js';

describe('SitepullError', () => {
  it('serializes stable, renderer-safe structured fields', () => {
    const error = new SitepullError({
      code: 'NAVIGATION_TIMEOUT',
      message: 'The page did not settle within 30 seconds.',
      stage: 'rendering',
      retryable: true,
      details: { url: 'https://example.com/' },
      cause: new Error('private implementation detail'),
    });

    const serialized = error.toJSON();

    expect(SerializedSitepullErrorSchema.parse(serialized)).toEqual(serialized);
    expect(serialized).toEqual({
      name: 'SitepullError',
      code: 'NAVIGATION_TIMEOUT',
      message: 'The page did not settle within 30 seconds.',
      stage: 'rendering',
      retryable: true,
      details: { url: 'https://example.com/' },
    });
    expect(serialized).not.toHaveProperty('stack');
    expect(serialized).not.toHaveProperty('cause');
  });

  it('preserves existing Sitepull errors and wraps unknown failures', () => {
    const existing = new SitepullError({ code: 'DNS_FAILED', message: 'Could not resolve host.' });
    expect(asSitepullError(existing, { code: 'INTERNAL_ERROR' })).toBe(existing);

    const wrapped = asSitepullError(new Error('disk unavailable'), {
      code: 'OUTPUT_NOT_WRITABLE',
      stage: 'building-project',
      retryable: true,
    });

    expect(isSitepullError(wrapped)).toBe(true);
    expect(wrapped.code).toBe('OUTPUT_NOT_WRITABLE');
    expect(wrapped.message).toBe('disk unavailable');
    expect(wrapped.cause).toBeInstanceOf(Error);
  });
});
