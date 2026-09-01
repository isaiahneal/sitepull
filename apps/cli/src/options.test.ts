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
      userAgent: null,
    });
    expect(parsed.request.config.viewports.map((viewport) => viewport.name)).toEqual([
      'desktop',
      'mobile',
    ]);
    expect(parsed.exportMode).toBeNull();
    expect(parsed.proxyPool).toBeNull();
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
        proxy: ['http://proxy-a.example:8080', 'https://proxy-b.example:8443'],
        proxySelection: 'random',
        proxyJitter: '250:1200',
        userAgent: 'Sitepull Test Browser/1.0',
        zip: true,
        aiPack: true,
        quiet: true,
      },
      {
        ...environment,
        proxyCredentialEnvironment: {
          SITEPULL_PROXY_1_USERNAME: 'first-user',
          SITEPULL_PROXY_1_PASSWORD: 'first-password',
          SITEPULL_PROXY_2_USERNAME: 'second-user',
          SITEPULL_PROXY_2_PASSWORD: 'second-password',
        },
      },
    );

    expect(parsed.request.outputDirectory).toBe(path.resolve('/work/project/references'));
    expect(parsed.request.config).toMatchObject({
      engine: 'chromium',
      maxDepth: 4,
      maxPages: 80,
      includeSubdomains: true,
      headed: true,
      pageTimeoutMs: 12_500,
      userAgent: 'Sitepull Test Browser/1.0',
    });
    expect(parsed.request.config.viewports).toEqual([
      { name: 'mobile', width: 390, height: 844 },
      { name: 'tablet', width: 1_024, height: 768 },
    ]);
    expect(parsed.exportMode).toBe('ai-pack');
    expect(parsed.proxyPool).toEqual({
      entries: [
        {
          server: 'http://proxy-a.example:8080',
          credentials: { username: 'first-user', password: 'first-password' },
        },
        {
          server: 'https://proxy-b.example:8443',
          credentials: { username: 'second-user', password: 'second-password' },
        },
      ],
      selection: 'random',
      jitter: { minMs: 250, maxMs: 1_200 },
    });
    expect(parsed.quiet).toBe(true);
  });

  it('maps the unnumbered credential aliases to the first proxy only', () => {
    const parsed = parsePullCommand(
      'example.com',
      { proxy: ['http://proxy-one.example:8080', 'http://proxy-two.example:8080'] },
      {
        ...environment,
        proxyCredentialEnvironment: {
          SITEPULL_PROXY_USERNAME: 'single-user',
          SITEPULL_PROXY_PASSWORD: 'single-password',
        },
      },
    );

    expect(parsed.proxyPool).toEqual({
      entries: [
        {
          server: 'http://proxy-one.example:8080',
          credentials: { username: 'single-user', password: 'single-password' },
        },
        { server: 'http://proxy-two.example:8080' },
      ],
      selection: 'round-robin',
      jitter: { minMs: 0, maxMs: 0 },
    });
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
    [{ proxySelection: 'random' }, /requires at least one --proxy/i],
    [{ proxyJitter: '1:2' }, /requires at least one --proxy/i],
    [{ proxy: 'socks5://proxy.example:1080' }, /http:\/\/ or https:\/\//i],
    [{ proxy: 'http://user:secret@proxy.example:8080' }, /credentials.*separately/i],
    [{ proxy: 'http://proxy.example:8080/path' }, /path, query, or fragment/i],
    [{ proxy: ['http://proxy.example:8080', 'http://proxy.example:8080'] }, /duplicate/i],
    [{ proxy: 'http://proxy.example:8080', proxySelection: 'shuffle' }, /round-robin or random/i],
    [{ proxy: 'http://proxy.example:8080', proxyJitter: '1000' }, /min:max/i],
    [{ proxy: 'http://proxy.example:8080', proxyJitter: '2000:1000' }, /minimum.*maximum/i],
    [{ proxy: 'http://proxy.example:8080', proxyJitter: '0:30001' }, /0 and 30000/i],
    [{ userAgent: 'bad\nagent' }, /printable ASCII/i],
  ] as const)('rejects invalid option input %#', (options, expected) => {
    expect(() => parsePullCommand('https://example.com', options, environment)).toThrow(expected);
  });

  it('rejects invalid URLs with a usage error', () => {
    expect(() => parsePullCommand('file:///etc/passwd', {}, environment)).toThrow(UsageError);
  });

  it.each([
    [
      {},
      {
        SITEPULL_PROXY_USERNAME: 'user',
        SITEPULL_PROXY_PASSWORD: 'password',
      },
      /no --proxy/i,
    ],
    [
      { proxy: 'http://proxy.example:8080' },
      { SITEPULL_PROXY_1_USERNAME: 'user' },
      /both USERNAME and PASSWORD/i,
    ],
    [
      { proxy: 'http://proxy.example:8080' },
      {
        SITEPULL_PROXY_2_USERNAME: 'user',
        SITEPULL_PROXY_2_PASSWORD: 'password',
      },
      /index 2.*matching --proxy/i,
    ],
    [
      { proxy: 'http://proxy.example:8080' },
      {
        SITEPULL_PROXY_USERNAME: 'alias-user',
        SITEPULL_PROXY_PASSWORD: 'alias-password',
        SITEPULL_PROXY_1_USERNAME: 'numbered-user',
        SITEPULL_PROXY_1_PASSWORD: 'numbered-password',
      },
      /either unnumbered.*not both/i,
    ],
    [
      { proxy: 'http://proxy.example:8080' },
      {
        SITEPULL_PROXY_33_USERNAME: 'user',
        SITEPULL_PROXY_33_PASSWORD: 'password',
      },
      /outside.*1-32/i,
    ],
    [
      { proxy: 'http://proxy.example:8080' },
      {
        SITEPULL_PROXY_TWO_USERNAME: 'user',
        SITEPULL_PROXY_TWO_PASSWORD: 'password',
      },
      /invalid proxy credential environment variable/i,
    ],
  ] as const)(
    'rejects invalid, partial, or unused proxy credentials %#',
    (options, proxyCredentialEnvironment, expected) => {
      expect(() =>
        parsePullCommand('example.com', options, {
          ...environment,
          proxyCredentialEnvironment,
        }),
      ).toThrow(expected);
    },
  );

  it('never includes proxy credential values in usage errors', () => {
    const secret = 'do-not-print-this-proxy-password';
    let message = '';
    try {
      parsePullCommand(
        'example.com',
        { proxy: 'http://proxy.example:8080' },
        {
          ...environment,
          proxyCredentialEnvironment: { SITEPULL_PROXY_PASSWORD: secret },
        },
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toContain(secret);
    expect(message).toMatch(/both USERNAME and PASSWORD/i);
  });
});
