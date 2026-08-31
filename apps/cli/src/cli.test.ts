import type { CaptureResultSummary } from '@sitepull/contracts';
import { describe, expect, it } from 'vitest';

import { runCli, SITEPULL_VERSION, type CliIo, type SignalSource } from './cli.js';
import type { PullDependencies } from './pull.js';

function completedSummary(): CaptureResultSummary {
  return {
    captureId: 'capture-1',
    status: 'completed',
    sourceUrl: 'https://example.com/',
    normalizedUrl: 'https://example.com/',
    hostname: 'example.com',
    outputDirectory: '/captures/example.com',
    startedAt: '2026-08-30T12:00:00.000Z',
    completedAt: '2026-08-30T12:00:01.000Z',
    durationMs: 1_000,
    counts: { pages: 1, assets: 2, components: 0, elements: 20, bytes: 2_048 },
    aiPack: null,
    fullCapture: null,
    error: null,
  };
}

function captureIo(): { io: CliIo; stdout: () => string; stderr: () => string } {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      writeStdout: (text) => {
        stdout += text;
      },
      writeStderr: (text) => {
        stderr += text;
      },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

function successfulDependencies(): PullDependencies {
  return {
    runCapture: () =>
      Promise.resolve({
        outputDirectory: '/captures/example.com',
        summary: completedSummary(),
      }),
    exportCaptureArchive: () =>
      Promise.resolve({
        archivePath: '/captures/example.com-full-capture.zip',
        compressedBytes: 1_024,
      }),
  };
}

describe('runCli', () => {
  it('prints only the final path to stdout in quiet mode', async () => {
    const output = captureIo();
    const exitCode = await runCli(['node', 'sitepull', 'pull', 'https://example.com', '--quiet'], {
      io: output.io,
      pullDependencies: successfulDependencies(),
    });

    expect(exitCode).toBe(0);
    expect(output.stdout()).toBe('/captures/example.com\n');
    expect(output.stderr()).toBe('');
  });

  it('returns exit code 2 for usage and option failures', async () => {
    const output = captureIo();
    const exitCode = await runCli(
      ['node', 'sitepull', 'pull', 'https://example.com', '--engine', 'safari'],
      { io: output.io, pullDependencies: successfulDependencies() },
    );

    expect(exitCode).toBe(2);
    expect(output.stdout()).toBe('');
    expect(output.stderr()).toContain('webkit, chromium, or firefox');
    expect(output.stderr()).toContain('sitepull pull --help');
  });

  it('honors short aliases and maps timeout seconds before invoking core', async () => {
    const output = captureIo();
    let observed:
      | {
          outputDirectory: string;
          maxDepth: number | undefined;
          maxPages: number | undefined;
          pageTimeoutMs: number | undefined;
          engine: string | undefined;
          viewports: readonly string[];
        }
      | undefined;
    const dependencies: PullDependencies = {
      ...successfulDependencies(),
      runCapture: (input) => {
        observed = {
          outputDirectory: input.outputDirectory,
          maxDepth: input.config?.maxDepth,
          maxPages: input.config?.maxPages,
          pageTimeoutMs: input.config?.pageTimeoutMs,
          engine: input.config?.engine,
          viewports: input.config?.viewports?.map((viewport) => viewport.name) ?? [],
        };
        return Promise.resolve({
          outputDirectory: '/captures/example.com',
          summary: completedSummary(),
        });
      },
    };

    const exitCode = await runCli(
      [
        'node',
        'sitepull',
        'pull',
        'https://example.com',
        '-o',
        '/tmp/sitepull-reference',
        '-d',
        '1',
        '-p',
        '3',
        '--timeout',
        '7',
        '--engine',
        'firefox',
        '--viewports',
        'mobile',
        '--quiet',
      ],
      { io: output.io, pullDependencies: dependencies },
    );

    expect(exitCode).toBe(0);
    expect(observed).toEqual({
      outputDirectory: '/tmp/sitepull-reference',
      maxDepth: 1,
      maxPages: 3,
      pageTimeoutMs: 7_000,
      engine: 'firefox',
      viewports: ['mobile'],
    });
  });

  it('returns exit code 1 and an actionable message for capture failures', async () => {
    const output = captureIo();
    const dependencies: PullDependencies = {
      ...successfulDependencies(),
      runCapture: () => Promise.reject(new Error('Playwright WebKit is not installed.')),
    };

    const exitCode = await runCli(['node', 'sitepull', 'pull', 'https://example.com'], {
      io: output.io,
      pullDependencies: dependencies,
    });

    expect(exitCode).toBe(1);
    expect(output.stdout()).toBe('');
    expect(output.stderr()).toContain('Playwright WebKit is not installed.');
  });

  it('aborts on the first SIGINT and returns exit code 130', async () => {
    const output = captureIo();
    const signals: SignalSource = {
      onceSigint: (listener) => {
        queueMicrotask(listener);
        return () => undefined;
      },
    };
    const dependencies: PullDependencies = {
      ...successfulDependencies(),
      runCapture: (_input, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => {
              const error = new Error('Capture cancelled.');
              Object.defineProperty(error, 'code', { value: 'CAPTURE_CANCELLED' });
              reject(error);
            },
            { once: true },
          );
        }),
    };

    const exitCode = await runCli(['node', 'sitepull', 'pull', 'https://example.com'], {
      io: output.io,
      signals,
      pullDependencies: dependencies,
    });

    expect(exitCode).toBe(130);
    expect(output.stdout()).toBe('');
    expect(output.stderr()).toContain('Cancellation requested');
    expect(output.stderr()).toContain('Sitepull cancelled');
  });

  it('supports generated help and version output without running a capture', async () => {
    const helpOutput = captureIo();
    const pullHelpOutput = captureIo();
    const versionOutput = captureIo();

    expect(await runCli(['node', 'sitepull', '--help'], { io: helpOutput.io })).toBe(0);
    expect(await runCli(['node', 'sitepull', 'pull', '--help'], { io: pullHelpOutput.io })).toBe(0);
    expect(await runCli(['node', 'sitepull', '--version'], { io: versionOutput.io })).toBe(0);
    expect(helpOutput.stdout()).toContain('pull <url>');
    expect(pullHelpOutput.stdout()).toContain('--ai-pack');
    expect(pullHelpOutput.stdout()).toContain('--headless');
    expect(pullHelpOutput.stdout()).toContain('sitepull pull example.com');
    expect(SITEPULL_VERSION).toBe('0.2.0');
    expect(versionOutput.stdout()).toContain('sitepull/0.2.0');
  });
});
