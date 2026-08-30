import { describe, expect, it } from 'vitest';

import { formatBytes, ProgressReporter } from './progress.js';

describe('CLI progress formatting', () => {
  it('formats binary sizes compactly', () => {
    expect(formatBytes(800)).toBe('800 B');
    expect(formatBytes(1_536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1_024 * 1_024)).toBe('5.0 MB');
  });

  it('reports stage truth without manufacturing percentages', () => {
    let output = '';
    const reporter = new ProgressReporter((text) => {
      output += text;
    }, false);
    reporter.start();
    reporter.onEvent({
      type: 'progress',
      captureId: 'capture-1',
      sequence: 1,
      timestamp: '2026-08-30T12:00:00.000Z',
      stage: 'crawling-pages',
      state: 'progress',
      message: 'Crawled 3 of 8 discovered pages.',
      currentUrl: 'https://example.com/pricing',
      elapsedMs: 1_000,
      counters: {
        discoveredPages: 8,
        completedPages: 3,
        assets: 12,
        elements: 400,
        bytesCaptured: 50_000,
      },
      determinate: { completed: 3, total: 8 },
    });

    expect(output).toContain('SITEPULL');
    expect(output).toContain('● Crawling pages — Crawled 3 of 8 discovered pages.');
    expect(output).not.toContain('%');
  });

  it('emits nothing in quiet mode', () => {
    let output = '';
    const reporter = new ProgressReporter((text) => {
      output += text;
    }, true);
    reporter.start();
    reporter.packaging('ai-pack');
    expect(output).toBe('');
  });
});
