import type { CaptureResultSummary } from '@sitepull/contracts';
import { describe, expect, it } from 'vitest';

import { parsePullCommand } from './options.js';
import { executePull, type PullDependencies } from './pull.js';

function summary(): CaptureResultSummary {
  return {
    captureId: 'example-com-20260830',
    status: 'completed',
    sourceUrl: 'https://example.com/',
    normalizedUrl: 'https://example.com/',
    hostname: 'example.com',
    outputDirectory: '/captures/example.com-2026-08-30',
    startedAt: '2026-08-30T12:00:00.000Z',
    completedAt: '2026-08-30T12:00:05.000Z',
    durationMs: 5_000,
    counts: { pages: 8, assets: 143, components: 11, elements: 2_418, bytes: 5_242_880 },
    aiPack: null,
    fullCapture: null,
    error: null,
  };
}

describe('executePull', () => {
  it('runs the shared core and exports an AI Pack ZIP when requested', async () => {
    const calls: string[] = [];
    let receivedFallbackPolicy: boolean | undefined;
    const dependencies: PullDependencies = {
      runCapture: (input, options) => {
        calls.push('capture');
        receivedFallbackPolicy = input.allowHttpFallback;
        options?.onEvent?.({
          type: 'progress',
          captureId: 'example-com-20260830',
          sequence: 0,
          timestamp: '2026-08-30T12:00:00.000Z',
          stage: 'launching-browser',
          state: 'started',
          message: 'Launching webkit.',
          currentUrl: 'https://example.com/',
          elapsedMs: 0,
          counters: {
            discoveredPages: 0,
            completedPages: 0,
            assets: 0,
            elements: 0,
            bytesCaptured: 0,
          },
          determinate: null,
        });
        return Promise.resolve({
          outputDirectory: '/captures/example.com-2026-08-30',
          summary: summary(),
        });
      },
      exportCaptureArchive: (options) => {
        calls.push(`export:${options.mode}:${options.captureRoot}`);
        return Promise.resolve({
          archivePath: '/captures/example.com-2026-08-30-ai-pack.zip',
          compressedBytes: 4_800_000,
        });
      },
    };
    const command = parsePullCommand('https://example.com', { zip: true, aiPack: true });
    let progress = '';

    const result = await executePull(
      command,
      new AbortController().signal,
      (text) => {
        progress += text;
      },
      dependencies,
    );

    expect(calls).toEqual(['capture', 'export:ai-pack:/captures/example.com-2026-08-30']);
    expect(receivedFallbackPolicy).toBe(false);
    expect(result.finalPath).toBe('/captures/example.com-2026-08-30-ai-pack.zip');
    expect(progress).toContain('● Launching browser');
    expect(progress).toContain('✓ Packaged AI Pack');
    expect(progress).toContain('Routes          8');
  });

  it('passes the inferred-scheme HTTP fallback policy to the shared core', async () => {
    let receivedFallbackPolicy: boolean | undefined;
    const dependencies: PullDependencies = {
      runCapture: (input) => {
        receivedFallbackPolicy = input.allowHttpFallback;
        return Promise.resolve({
          outputDirectory: '/captures/example.com-2026-08-30',
          summary: summary(),
        });
      },
      exportCaptureArchive: () =>
        Promise.resolve({ archivePath: '/unexpected.zip', compressedBytes: 1 }),
    };

    await executePull(
      parsePullCommand('example.com', { quiet: true }),
      new AbortController().signal,
      () => undefined,
      dependencies,
    );

    expect(receivedFallbackPolicy).toBe(true);
  });

  it('passes the proxy pool through RunCaptureOptions and the custom UA through config', async () => {
    let receivedOptions: Parameters<PullDependencies['runCapture']>[1];
    let receivedUserAgent: string | null | undefined;
    const dependencies: PullDependencies = {
      runCapture: (input, options) => {
        receivedOptions = options;
        receivedUserAgent = input.config?.userAgent;
        return Promise.resolve({
          outputDirectory: '/captures/example.com-2026-08-30',
          summary: summary(),
        });
      },
      exportCaptureArchive: () =>
        Promise.resolve({ archivePath: '/unexpected.zip', compressedBytes: 1 }),
    };
    const command = parsePullCommand(
      'example.com',
      {
        proxy: ['http://proxy-one.example:8080', 'https://proxy-two.example:8443'],
        proxySelection: 'random',
        proxyJitter: '25:125',
        userAgent: 'Sitepull Custom UA/1.0',
        quiet: true,
      },
      {
        proxyCredentialEnvironment: {
          SITEPULL_PROXY_2_USERNAME: 'proxy-user',
          SITEPULL_PROXY_2_PASSWORD: 'proxy-password',
        },
      },
    );

    await executePull(command, new AbortController().signal, () => undefined, dependencies);

    expect(receivedUserAgent).toBe('Sitepull Custom UA/1.0');
    expect(receivedOptions?.proxyPool).toEqual({
      entries: [
        { server: 'http://proxy-one.example:8080' },
        {
          server: 'https://proxy-two.example:8443',
          credentials: { username: 'proxy-user', password: 'proxy-password' },
        },
      ],
      selection: 'random',
      jitter: { minMs: 25, maxMs: 125 },
    });
  });

  it('returns the capture directory without invoking export when --zip is absent', async () => {
    let exported = false;
    const dependencies: PullDependencies = {
      runCapture: () =>
        Promise.resolve({
          outputDirectory: '/captures/example.com-2026-08-30',
          summary: summary(),
        }),
      exportCaptureArchive: () => {
        exported = true;
        return Promise.resolve({ archivePath: '/unexpected.zip', compressedBytes: 1 });
      },
    };

    const result = await executePull(
      parsePullCommand('https://example.com', { quiet: true }),
      new AbortController().signal,
      () => {
        throw new Error('Quiet mode should not write progress.');
      },
      dependencies,
    );

    expect(exported).toBe(false);
    expect(result.finalPath).toBe('/captures/example.com-2026-08-30');
  });
});
