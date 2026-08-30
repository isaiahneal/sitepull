import { homedir } from 'node:os';
import path from 'node:path';

import {
  BrowserEngineSchema,
  CrawlRequestSchema,
  normalizeHttpUrlInput,
  VIEWPORT_PRESETS,
  type CrawlRequest,
  type ExportMode,
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
  readonly zip?: unknown;
  readonly aiPack?: unknown;
  readonly quiet?: unknown;
}

export interface ParsedPullCommand {
  readonly request: CrawlRequest;
  readonly allowHttpFallback: boolean;
  readonly exportMode: ExportMode | null;
  readonly quiet: boolean;
}

export interface ParseEnvironment {
  readonly homeDirectory?: string;
  readonly currentDirectory?: string;
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
  const engine = parseEngine(options.engine);
  const viewports = parseViewports(options.viewports);
  const pageTimeoutMs = parseTimeoutMilliseconds(options.timeout);
  const includeSubdomains = optionalBoolean(options.includeSubdomains, '--include-subdomains');
  const headed = optionalBoolean(options.headed, '--headed');
  const headless = optionalBoolean(options.headless, '--headless');
  const zip = optionalBoolean(options.zip, '--zip');
  const aiPack = optionalBoolean(options.aiPack, '--ai-pack');
  const quiet = optionalBoolean(options.quiet, '--quiet');

  if (aiPack && !zip) throw new UsageError('--ai-pack requires --zip.');
  if (headed && headless) throw new UsageError('--headed and --headless cannot be used together.');

  const request = CrawlRequestSchema.safeParse({
    url: normalizedInput.url,
    outputDirectory,
    config: {
      ...(maxDepth === undefined ? {} : { maxDepth }),
      ...(maxPages === undefined ? {} : { maxPages }),
      ...(engine === undefined ? {} : { engine }),
      ...(viewports === undefined ? {} : { viewports }),
      ...(pageTimeoutMs === undefined ? {} : { pageTimeoutMs }),
      includeSubdomains,
      headed,
    },
  });
  if (!request.success) throw new UsageError(formatContractError(request.error));

  return {
    request: request.data,
    allowHttpFallback: normalizedInput.protocolInferred,
    exportMode: zip ? (aiPack ? 'ai-pack' : 'full-capture') : null,
    quiet,
  };
}
