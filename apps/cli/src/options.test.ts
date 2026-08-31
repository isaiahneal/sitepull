import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parsePullCommand, UsageError } from './options.js';

const environment = {
  homeDirectory: '/Users/tester',
  currentDirectory: '/work/project',
} as const;

describe('parsePullCommand', () => {
  it('uses the contract defaults and ~/Sitepull output root', () => {
    const parsed = parsePullCommand('https://example.com', {}, environment);

    expect(parsed.request.outputDirectory).toBe('/Users/tester/Sitepull');
    expect(parsed.request.config).toMatchObject({
      engine: 'webkit',
      maxDepth: 2,
      maxPages: 25,
      includeSubdomains: false,
      headed: false,
      pageTimeoutMs: 30_000,
    });
    expect(parsed.request.config.viewports.map((viewport) => viewport.name)).toEqual([
      'desktop',
      'mobile',
    ]);
    expect(parsed.exportMode).toBeNull();
    expect(parsed.quiet).toBe(false);
  });

  it('maps every pull flag into a validated crawl request and AI Pack export', () => {
    const parsed = parsePullCommand(
      'https://example.com/docs',
      {
        output: './references',
        depth: '4',
        maxPages: 80,
        engine: 'chromium',
        viewports: 'mobile,tablet',
        includeSubdomains: true,
        headed: true,
        timeout: '12.5',
        zip: true,
        aiPack: true,
        quiet: true,
      },
      environment,
    );

    expect(parsed.request.outputDirectory).toBe(path.resolve('/work/project/references'));
    expect(parsed.request.config).toMatchObject({
      engine: 'chromium',
      maxDepth: 4,
      maxPages: 80,
      includeSubdomains: true,
      headed: true,
      pageTimeoutMs: 12_500,
    });
    expect(parsed.request.config.viewports).toEqual([
      { name: 'mobile', width: 390, height: 844 },
      { name: 'tablet', width: 1_024, height: 768 },
    ]);
    expect(parsed.exportMode).toBe('ai-pack');
    expect(parsed.quiet).toBe(true);
  });

  it('uses and enforces a package-provided system browser engine', () => {
    const systemBrowserEnvironment = {
      ...environment,
      defaultEngine: 'chromium',
      supportedEngines: ['chromium'],
    } as const;

    expect(
      parsePullCommand('example.com', {}, systemBrowserEnvironment).request.config.engine,
    ).toBe('chromium');
    expect(() =>
      parsePullCommand('example.com', { engine: 'webkit' }, systemBrowserEnvironment),
    ).toThrow(/supports chromium only/iu);
  });

  it('rejects headed mode only when the package is headless-only', () => {
    const headlessPackageEnvironment = { ...environment, headlessOnly: true } as const;

    expect(() =>
      parsePullCommand('example.com', { headed: true }, headlessPackageEnvironment),
    ).toThrow(/headless-only.*remove --headed/iu);
    expect(
      parsePullCommand('example.com', { headless: true }, headlessPackageEnvironment).request.config
        .headed,
    ).toBe(false);
    expect(
      parsePullCommand('example.com', { headed: true }, environment).request.config.headed,
    ).toBe(true);
  });

  it('selects Full Capture when --zip is used without --ai-pack', () => {
    expect(parsePullCommand('https://example.com', { zip: true }, environment).exportMode).toBe(
      'full-capture',
    );
  });

  it('accepts an explicit headless flag while preserving the headless default', () => {
    const parsed = parsePullCommand('https://example.com', { headless: true }, environment);

    expect(parsed.request.config.headed).toBe(false);
  });

  it('infers HTTPS for a bare host and permits a guarded HTTP retry', () => {
    const parsed = parsePullCommand('example.com/docs', {}, environment);

    expect(parsed.request.url).toBe('https://example.com/docs');
    expect(parsed.allowHttpFallback).toBe(true);
    expect(parsePullCommand('https://example.com', {}, environment).allowHttpFallback).toBe(false);
  });

  it.each([
    [{ aiPack: true }, /requires --zip/i],
    [{ engine: 'safari' }, /webkit, chromium, or firefox/i],
    [{ viewports: 'desktop,desktop' }, /duplicate/i],
    [{ viewports: 'watch' }, /unknown viewport/i],
    [{ timeout: '0.5' }, /between 1 and 300/i],
    [{ timeout: '1.0001' }, /millisecond precision/i],
    [{ depth: 'two' }, /must be an integer/i],
    [{ maxPages: 0 }, /between 1 and 500/i],
    [{ headed: true, headless: true }, /cannot be used together/i],
  ] as const)('rejects invalid option input %#', (options, expected) => {
    expect(() => parsePullCommand('https://example.com', options, environment)).toThrow(expected);
  });

  it('rejects invalid URLs with a usage error', () => {
    expect(() => parsePullCommand('file:///etc/passwd', {}, environment)).toThrow(UsageError);
  });
});
