import { describe, expect, it } from 'vitest';

import {
  captureElapsedMs,
  captureFileUrl,
  formatBytes,
  isTextPreviewable,
  normalizeUrlInput,
  normalizeUrlRequestInput,
  safeCssColor,
} from './utils.js';

describe('renderer utilities', () => {
  it('normalizes a hostname to an HTTPS URL', () => {
    expect(normalizeUrlInput('example.com/docs')).toBe('https://example.com/docs');
    expect(normalizeUrlRequestInput('example.com/docs').protocolInferred).toBe(true);
    expect(normalizeUrlRequestInput('https://example.com/docs').protocolInferred).toBe(false);
  });

  it('rejects non-web protocols and embedded credentials', () => {
    expect(() => normalizeUrlInput('file:///etc/passwd')).toThrow(/HTTP and HTTPS/u);
    expect(() => normalizeUrlInput('https://user:secret@example.com')).toThrow(/credentials/u);
  });

  it('creates an encoded, capture-scoped artifact URL', () => {
    expect(captureFileUrl('capture 1', 'pages/home hero/screenshots/desktop.png')).toBe(
      'sitepull-capture://capture/capture%201/pages/home%20hero/screenshots/desktop.png',
    );
  });

  it('formats capture sizes without overstating precision', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1_572_864)).toBe('1.5 MB');
    expect(formatBytes(12_582_912)).toBe('12 MB');
  });

  it('keeps elapsed capture time moving between progress events', () => {
    expect(captureElapsedMs(1_000, 0, 31_000)).toBe(30_000);
    expect(captureElapsedMs(10_000, 8_000, 12_000)).toBe(8_000);
    expect(captureElapsedMs(null, 4_000, 20_000)).toBe(4_000);
  });

  it('retains strict colors without allowing URL-capable CSS', () => {
    expect(safeCssColor('oklch(72% .15 252)')).toBe('oklch(72% .15 252)');
    expect(safeCssColor('lab(62% 18 -35)')).toBe('lab(62% 18 -35)');
    expect(safeCssColor('color(display-p3 0.8 0.2 0.4)')).toBe('color(display-p3 0.8 0.2 0.4)');
    expect(safeCssColor('url(https://example.com/pixel.png)')).toBe('transparent');
    expect(safeCssColor('inherit')).toBe('transparent');
  });

  it('only marks file extensions supported by the desktop preview bridge as text', () => {
    expect(isTextPreviewable('logs/sitepull.jsonl')).toBe(true);
    expect(isTextPreviewable('scripts/app.js')).toBe(true);
    expect(isTextPreviewable('scripts/source.ts')).toBe(false);
    expect(isTextPreviewable('data/export.csv')).toBe(false);
  });
});
