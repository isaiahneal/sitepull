import { homedir } from 'node:os';
import path from 'node:path';

import {
  BrowserEngineSchema,
  CrawlRequestSchema,
  MAX_PROXY_JITTER_MS,
  MAX_PROXY_POOL_ENTRIES,
  ProxyPoolRequestSchema,
  ProxySelectionModeSchema,
  normalizeHttpUrlInput,
  VIEWPORT_PRESETS,
  type CrawlRequest,
  type BrowserEngine,
  type ExportMode,
  type ProxyJitter,
  type ProxyPoolRequest,
  type ProxySelectionMode,
  type Viewport,
} from '@sitepull/contracts';

export interface RawPullOptions extends Readonly<Record<string, unknown>> {
  readonly output?: unknown;
  readonly depth?: unknown;
  readonly maxPages?: unknown;
  readonly engine?: unknown;
  readonly viewports?: unknown;
  readonly includeSubdomains?: unknown;
  readonly headed?: unknown;
  readonly headless?: unknown;
  readonly timeout?: unknown;
  readonly proxy?: unknown;
  readonly proxySelection?: unknown;
  readonly proxyJitter?: unknown;
  readonly userAgent?: unknown;
  readonly zip?: unknown;
  readonly aiPack?: unknown;
  readonly quiet?: unknown;
}

export interface ParsedPullCommand {
  readonly request: CrawlRequest;
  readonly allowHttpFallback: boolean;
  readonly proxyPool: ProxyPoolRequest | null;
  readonly exportMode: ExportMode | null;
  readonly quiet: boolean;
}

export interface ParseEnvironment {
  readonly homeDirectory?: string;
  readonly currentDirectory?: string;
  readonly defaultEngine?: BrowserEngine;
  readonly supportedEngines?: readonly BrowserEngine[];
  readonly headlessOnly?: boolean;
  /** Proxy-only environment values captured and removed from the child-process environment. */
  readonly proxyCredentialEnvironment?: Readonly<Record<string, string>>;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

function singleValue(value: unknown, option: string): unknown {
  if (Array.isArray(value)) {
    throw new UsageError(`${option} may only be provided once.`);
  }
  return value;
}

function optionalString(value: unknown, option: string): string | undefined {
  const single = singleValue(value, option);
  if (single === undefined) return undefined;
  if (typeof single !== 'string' && typeof single !== 'number') {
    throw new UsageError(`${option} requires a value.`);
  }
  const text = String(single).trim();
  if (text === '') throw new UsageError(`${option} requires a non-empty value.`);
  return text;
}

function optionalBoolean(value: unknown, option: string): boolean {
  const single = singleValue(value, option);
  if (single === undefined) return false;
  if (typeof single !== 'boolean') throw new UsageError(`${option} does not accept a value.`);
  return single;
}

function optionalInteger(value: unknown, option: string): number | undefined {
  const text = optionalString(value, option);
  if (text === undefined) return undefined;
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) throw new UsageError(`${option} must be an integer.`);
  return parsed;
}

function repeatedStrings(value: unknown, option: string): string[] {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0) throw new UsageError(`${option} requires a value.`);
  return values.map((entry) => {
    if (typeof entry !== 'string' && typeof entry !== 'number') {
      throw new UsageError(`${option} requires a value.`);
    }
    const text = String(entry).trim();
    if (text === '') throw new UsageError(`${option} requires a non-empty value.`);
    return text;
  });
}

function parseEngine(value: unknown): 'webkit' | 'chromium' | 'firefox' | undefined {
  const engine = optionalString(value, '--engine');
  if (engine === undefined) return undefined;
  const parsed = BrowserEngineSchema.safeParse(engine.toLowerCase());
  if (!parsed.success) throw new UsageError('--engine must be webkit, chromium, or firefox.');
  return parsed.data;
}

function viewportPreset(name: string): Viewport | undefined {
  if (name === 'desktop') return { ...VIEWPORT_PRESETS.desktop };
  if (name === 'mobile') return { ...VIEWPORT_PRESETS.mobile };
  if (name === 'tablet') return { ...VIEWPORT_PRESETS.tablet };
  return undefined;
}

function parseViewports(value: unknown): Viewport[] | undefined {
  const input = optionalString(value, '--viewports');
  if (input === undefined) return undefined;
  const names = input
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== '');
  if (names.length === 0) throw new UsageError('--viewports requires at least one preset.');
  if (new Set(names).size !== names.length) {
    throw new UsageError('--viewports cannot contain duplicate presets.');
  }

  return names.map((name) => {
    const preset = viewportPreset(name);
    if (preset === undefined) {
      throw new UsageError(`Unknown viewport preset "${name}"; use desktop, mobile, or tablet.`);
    }
    return preset;
  });
}

function parseTimeoutMilliseconds(value: unknown): number | undefined {
  const input = optionalString(value, '--timeout');
  if (input === undefined) return undefined;
  const seconds = Number(input);
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 300) {
    throw new UsageError('--timeout must be between 1 and 300 seconds.');
  }
  const milliseconds = seconds * 1_000;
  if (!Number.isSafeInteger(milliseconds)) {
    throw new UsageError('--timeout supports at most millisecond precision.');
  }
  return milliseconds;
}

function parseProxySelection(value: unknown): ProxySelectionMode | undefined {
  const input = optionalString(value, '--proxy-selection');
  if (input === undefined) return undefined;
  const parsed = ProxySelectionModeSchema.safeParse(input.toLowerCase());
  if (!parsed.success) {
    throw new UsageError('--proxy-selection must be round-robin or random.');
  }
  return parsed.data;
}

function parseProxyJitter(value: unknown): ProxyJitter | undefined {
  const input = optionalString(value, '--proxy-jitter');
  if (input === undefined) return undefined;
  const match = /^(\d+):(\d+)$/u.exec(input);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new UsageError('--proxy-jitter must use min:max milliseconds, for example 250:1200.');
  }
  const minMs = Number(match[1]);
  const maxMs = Number(match[2]);
  if (!Number.isSafeInteger(minMs) || !Number.isSafeInteger(maxMs)) {
    throw new UsageError('--proxy-jitter values must be safe integers.');
  }
  if (minMs > maxMs) {
    throw new UsageError('--proxy-jitter minimum cannot exceed its maximum.');
  }
  if (maxMs > MAX_PROXY_JITTER_MS) {
    throw new UsageError(
      `--proxy-jitter values must be between 0 and ${MAX_PROXY_JITTER_MS} milliseconds.`,
    );
  }
  return { minMs, maxMs };
}

function proxyCredentialPairs(
  values: Readonly<Record<string, string>>,
  proxyCount: number,
): ReadonlyMap<number, Readonly<{ username: string; password: string }>> {
  const pairs = new Map<number, { username?: string; password?: string }>();
  const unnumbered: { username?: string; password?: string } = {};

  for (const [name, value] of Object.entries(values)) {
    if (name === 'SITEPULL_PROXY_USERNAME') {
      unnumbered.username = value;
      continue;
    }
    if (name === 'SITEPULL_PROXY_PASSWORD') {
      unnumbered.password = value;
      continue;
    }

    const match = /^SITEPULL_PROXY_(.+)_(USERNAME|PASSWORD)$/u.exec(name);
    if (match?.[1] === undefined || match[2] === undefined || !/^[1-9]\d*$/u.test(match[1])) {
      throw new UsageError(`Invalid proxy credential environment variable ${name}.`);
    }
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || index > MAX_PROXY_POOL_ENTRIES) {
      throw new UsageError(
        `${name} uses a proxy index outside the supported range 1-${MAX_PROXY_POOL_ENTRIES}.`,
      );
    }
    const pair = pairs.get(index) ?? {};
    if (match[2] === 'USERNAME') pair.username = value;
    else pair.password = value;
    pairs.set(index, pair);
  }

  if (proxyCount === 0 && (pairs.size > 0 || Object.keys(unnumbered).length > 0)) {
    throw new UsageError('Proxy credentials were supplied but no --proxy was configured.');
  }
  if ((unnumbered.username !== undefined || unnumbered.password !== undefined) && pairs.has(1)) {
    throw new UsageError(
      'Use either unnumbered proxy credentials or SITEPULL_PROXY_1_USERNAME/PASSWORD, not both.',
    );
  }
  if (unnumbered.username !== undefined || unnumbered.password !== undefined) {
    pairs.set(1, unnumbered);
  }

  const complete = new Map<number, { username: string; password: string }>();
  for (const [index, pair] of pairs) {
    if (index > proxyCount) {
      throw new UsageError(`Proxy credentials for index ${index} do not have a matching --proxy.`);
    }
    if (pair.username === undefined || pair.password === undefined) {
      throw new UsageError(
        `Proxy credentials for index ${index} require both USERNAME and PASSWORD variables.`,
      );
    }
    complete.set(index, { username: pair.username, password: pair.password });
  }
  return complete;
}

function parseProxyPool(
  options: RawPullOptions,
  environment: ParseEnvironment,
): ProxyPoolRequest | null {
  const servers = repeatedStrings(options.proxy, '--proxy');
  const selection = parseProxySelection(options.proxySelection);
  const jitter = parseProxyJitter(options.proxyJitter);
  if (servers.length === 0) {
    if (selection !== undefined) {
      throw new UsageError('--proxy-selection requires at least one --proxy.');
    }
    if (jitter !== undefined) throw new UsageError('--proxy-jitter requires at least one --proxy.');
  }

  const credentials = proxyCredentialPairs(
    environment.proxyCredentialEnvironment ?? {},
    servers.length,
  );
  if (servers.length === 0) return null;

  const parsed = ProxyPoolRequestSchema.safeParse({
    entries: servers.map((server, offset) => {
      const pair = credentials.get(offset + 1);
      return {
        server,
        ...(pair === undefined ? {} : { credentials: pair }),
      };
    }),
    selection: selection ?? 'round-robin',
    jitter: jitter ?? { minMs: 0, maxMs: 0 },
  });
  if (!parsed.success) throw new UsageError(formatContractError(parsed.error));
  return parsed.data;
}

function expandOutputPath(input: string, homeDirectory: string, currentDirectory: string): string {
  const expanded =
    input === '~'
      ? homeDirectory
      : input.startsWith('~/')
        ? path.join(homeDirectory, input.slice(2))
        : input;
  return path.resolve(currentDirectory, expanded);
}

function formatContractError(error: {
  readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[];
}): string {
  const issue = error.issues[0];
  if (issue === undefined) return 'Invalid crawl configuration.';
  const location = issue.path.length === 0 ? '' : `${issue.path.map(String).join('.')}: `;
  return `${location}${issue.message}`;
}

export function parsePullCommand(
  url: unknown,
  options: RawPullOptions,
  environment: ParseEnvironment = {},
): ParsedPullCommand {
  if (typeof url !== 'string' || url.trim() === '') {
    throw new UsageError('pull requires a website URL.');
  }
  let normalizedInput: ReturnType<typeof normalizeHttpUrlInput>;
  try {
    normalizedInput = normalizeHttpUrlInput(url);
  } catch {
    throw new UsageError('pull requires a valid website host or HTTP(S) URL.');
  }

  const homeDirectory = environment.homeDirectory ?? homedir();
  const currentDirectory = environment.currentDirectory ?? process.cwd();
  const outputOption = optionalString(options.output, '--output');
  const outputDirectory = expandOutputPath(
    outputOption ?? path.join(homeDirectory, 'Sitepull'),
    homeDirectory,
    currentDirectory,
  );
  const maxDepth = optionalInteger(options.depth, '--depth');
  const maxPages = optionalInteger(options.maxPages, '--max-pages');
  if (maxDepth !== undefined && (maxDepth < 0 || maxDepth > 10)) {
    throw new UsageError('--depth must be between 0 and 10.');
  }
  if (maxPages !== undefined && (maxPages < 1 || maxPages > 500)) {
    throw new UsageError('--max-pages must be between 1 and 500.');
  }
  const engine = parseEngine(options.engine) ?? environment.defaultEngine;
  if (
    engine !== undefined &&
    environment.supportedEngines !== undefined &&
    !environment.supportedEngines.includes(engine)
  ) {
    throw new UsageError(
      `This Sitepull package supports ${environment.supportedEngines.join(', ')} only.`,
    );
  }
  const viewports = parseViewports(options.viewports);
  const pageTimeoutMs = parseTimeoutMilliseconds(options.timeout);
  const proxyPool = parseProxyPool(options, environment);
  const userAgent = optionalString(options.userAgent, '--user-agent');
  const includeSubdomains = optionalBoolean(options.includeSubdomains, '--include-subdomains');
  const headed = optionalBoolean(options.headed, '--headed');
  const headless = optionalBoolean(options.headless, '--headless');
  const zip = optionalBoolean(options.zip, '--zip');
  const aiPack = optionalBoolean(options.aiPack, '--ai-pack');
  const quiet = optionalBoolean(options.quiet, '--quiet');

  if (aiPack && !zip) throw new UsageError('--ai-pack requires --zip.');
  if (headed && headless) throw new UsageError('--headed and --headless cannot be used together.');
  if (environment.headlessOnly === true && headed) {
    throw new UsageError(
      'This Sitepull package is headless-only; remove --headed (headless mode is the default).',
    );
  }

  const request = CrawlRequestSchema.safeParse({
    url: normalizedInput.url,
    outputDirectory,
    config: {
      ...(maxDepth === undefined ? {} : { maxDepth }),
      ...(maxPages === undefined ? {} : { maxPages }),
      ...(engine === undefined ? {} : { engine }),
      ...(viewports === undefined ? {} : { viewports }),
      ...(pageTimeoutMs === undefined ? {} : { pageTimeoutMs }),
      ...(userAgent === undefined ? {} : { userAgent }),
      includeSubdomains,
      headed,
    },
  });
  if (!request.success) throw new UsageError(formatContractError(request.error));

  return {
    request: request.data,
    allowHttpFallback: normalizedInput.protocolInferred,
    proxyPool,
    exportMode: zip ? (aiPack ? 'ai-pack' : 'full-capture') : null,
    quiet,
  };
}
