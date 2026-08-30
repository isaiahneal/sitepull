import { describe, expect, it } from 'vitest';

import {
  classifyResource,
  deterministicAssetPath,
  isTextResource,
  sha256Hex,
} from './resources.js';

describe('resource hashing and classification', () => {
  it('generates the standard SHA-256 digest without platform-dependent encoding', () => {
    expect(sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
    expect(sha256Hex(new Uint8Array([0, 1, 2]))).toBe(
      'ae4b3280e56e2faf83f414a6e3dabe9d5fbe18976544c05fed121accb85b53fc',
    );
  });

  it('prefers MIME types, then useful extensions, then browser resource types', () => {
    expect(
      classifyResource({
        url: 'https://example.com/render?id=1',
        contentType: 'image/svg+xml; charset=utf-8',
      }),
    ).toBe('svg');
    expect(classifyResource({ url: 'https://example.com/app.php', contentType: 'text/css' })).toBe(
      'css',
    );
    expect(classifyResource({ url: 'https://example.com/font.woff2' })).toBe('font');
    expect(
      classifyResource({ url: 'https://example.com/chunk', browserResourceType: 'script' }),
    ).toBe('javascript');
    expect(
      classifyResource({
        url: 'https://example.com/data',
        contentType: 'application/problem+json',
      }),
    ).toBe('json');
  });
});

describe('deterministicAssetPath', () => {
  const digest = sha256Hex('same delivered bytes');

  it('creates readable sanitized paths with a digest suffix and useful extension', () => {
    expect(
      deterministicAssetPath({
        url: 'https://cdn.example.com/assets/H%C3%A9ro%20Image.PNG?width=1200',
        contentType: 'image/png',
        sha256: digest,
      }),
    ).toBe(`assets/images/Hero-Image-${digest.slice(0, 8)}.png`);
  });

  it('is independent of query strings and corrects misleading extensions from MIME data', () => {
    const first = deterministicAssetPath({
      url: 'https://example.com/styles/site.php?v=1',
      contentType: 'text/css',
      sha256: digest,
    });
    const second = deterministicAssetPath({
      url: 'https://example.com/styles/site.php?v=2',
      contentType: 'text/css',
      sha256: digest,
    });

    expect(first).toBe(`assets/css/site-${digest.slice(0, 8)}.css`);
    expect(second).toBe(first);
    expect(isTextResource('css')).toBe(true);
    expect(isTextResource('image')).toBe(false);
  });

  it('rejects malformed digests', () => {
    expect(() =>
      deterministicAssetPath({
        url: 'https://example.com/a.png',
        contentType: 'image/png',
        sha256: '1234',
      }),
    ).toThrow(/64-character hexadecimal/i);
  });
});
