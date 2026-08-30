import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  resolvePathWithinRoot,
  resolvePathWithoutSymlinks,
  routeSlug,
  sanitizeFilename,
} from './paths.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('sanitizeFilename', () => {
  it('removes traversal, controls, separators, and portable reserved names', () => {
    expect(sanitizeFilename('../../My Screenshot\u0000 final.png')).toBe('My-Screenshot-final.png');
    expect(sanitizeFilename('CON')).toBe('_CON');
    expect(sanitizeFilename('Crème brûlée.svg')).toBe('Creme-brulee.svg');
    expect(sanitizeFilename('', { fallback: '../../fallback' })).toBe('fallback');
  });

  it('preserves a useful extension when truncating', () => {
    expect(sanitizeFilename(`${'x'.repeat(100)}.woff2`, { maxLength: 24 })).toMatch(
      /^x{18}\.woff2$/,
    );
  });
});

describe('safe path resolution', () => {
  it.each([
    '../outside',
    '..\\outside',
    '%2e%2e/secret',
    '%252e%252e/secret',
    '/absolute',
    'C:\\escape',
  ])('rejects traversal form %s', (unsafePath) => {
    expect(() => resolvePathWithinRoot('/tmp/sitepull-capture', unsafePath)).toThrow(/escapes/i);
  });

  it('allows a nested path that remains inside the root', () => {
    expect(resolvePathWithinRoot('/tmp/sitepull-capture', 'pages/home/rendered.html')).toBe(
      path.resolve('/tmp/sitepull-capture/pages/home/rendered.html'),
    );
  });

  it('rejects an existing symlink component beneath the root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sitepull-path-test-'));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, 'pages'));
    await symlink(tmpdir(), path.join(root, 'pages', 'escape'));

    await expect(resolvePathWithoutSymlinks(root, 'pages/escape/file.txt')).rejects.toThrow(
      /escapes/i,
    );
  });
});

describe('routeSlug', () => {
  it('uses readable path segments and a deterministic query suffix', () => {
    expect(routeSlug('https://example.com/')).toBe('home');
    expect(routeSlug('https://example.com/Blog/Hello%20World')).toBe('blog__hello-world');
    expect(routeSlug('https://example.com/search?q=cards')).toMatch(/^search--q-[a-f0-9]{8}$/);
    expect(routeSlug('https://example.com/search?q=cards')).toBe(
      routeSlug('https://example.com/search?q=cards'),
    );
  });
});
