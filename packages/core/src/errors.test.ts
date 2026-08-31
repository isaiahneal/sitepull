import { describe, expect, it } from 'vitest';

import {
  MAX_SITEPULL_ERROR_MESSAGE_LENGTH,
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

  it('bounds serialized browser diagnostics to the shared contract limit', () => {
    const error = new SitepullError({
      code: 'CRAWL_FAILED',
      message: 'browser stderr\n'.repeat(2_000),
      stage: 'crawling-pages',
      retryable: true,
    });

    expect(error.message.length).toBeGreaterThan(MAX_SITEPULL_ERROR_MESSAGE_LENGTH);
    const serialized = error.toJSON();
    expect(serialized.message).toHaveLength(MAX_SITEPULL_ERROR_MESSAGE_LENGTH);
    expect(serialized.message).toContain('\n… [truncated] …\n');
    expect(serialized.message).toMatch(/browser stderr\n$/u);
    expect(SerializedSitepullErrorSchema.parse(serialized)).toEqual(serialized);
  });

  it('leaves messages at and below the contract boundary unchanged', () => {
    for (const length of [
      MAX_SITEPULL_ERROR_MESSAGE_LENGTH - 1,
      MAX_SITEPULL_ERROR_MESSAGE_LENGTH,
    ]) {
      const message = 'x'.repeat(length);
      const error = new SitepullError({ code: 'CRAWL_FAILED', message });

      expect(error.toJSON().message).toBe(message);
      expect(SerializedSitepullErrorSchema.parse(error.toJSON())).toEqual(error.toJSON());
    }

    const oversized = `HEAD${'x'.repeat(MAX_SITEPULL_ERROR_MESSAGE_LENGTH)}TAIL`;
    const serialized = new SitepullError({ code: 'CRAWL_FAILED', message: oversized }).toJSON();
    expect(serialized.message).toHaveLength(MAX_SITEPULL_ERROR_MESSAGE_LENGTH);
    expect(serialized.message).toMatch(/^HEAD/u);
    expect(serialized.message).toContain('\n… [truncated] …\n');
    expect(serialized.message).toMatch(/TAIL$/u);
  });

  it('normalizes an empty error message before serialization', () => {
    const error = new SitepullError({ code: 'INTERNAL_ERROR', message: '' });

    expect(error.message).toBe('');
    expect(error.toJSON().message).toBe('Sitepull failed unexpectedly.');
    expect(SerializedSitepullErrorSchema.parse(error.toJSON())).toEqual(error.toJSON());
  });
});
