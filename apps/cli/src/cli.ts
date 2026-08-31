import { format } from 'node:util';

import { SITEPULL_VERSION } from '@sitepull/contracts';
import cac, { type CAC } from 'cac';

import { UsageError, parsePullCommand, type RawPullOptions } from './options.js';
import { executePull, DEFAULT_PULL_DEPENDENCIES, type PullDependencies } from './pull.js';

export { SITEPULL_VERSION } from '@sitepull/contracts';

export interface CliIo {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
}

export interface SignalSource {
  readonly onceSigint: (listener: () => void) => () => void;
}

export interface CliRuntime {
  readonly io?: CliIo;
  readonly signals?: SignalSource;
  readonly pullDependencies?: PullDependencies;
}

const DEFAULT_IO: CliIo = {
  writeStdout: (text) => {
    process.stdout.write(text);
  },
  writeStderr: (text) => {
    process.stderr.write(text);
  },
};

const DEFAULT_SIGNALS: SignalSource = {
  onceSigint: (listener) => {
    process.once('SIGINT', listener);
    return () => {
      process.off('SIGINT', listener);
    };
  },
};

function captureConsoleInfo<T>(write: (text: string) => void, action: () => T): T {
  const original = console.info;
  console.info = (...values: unknown[]) => {
    write(`${format(...values)}\n`);
  };
  try {
    return action();
  } finally {
    console.info = original;
  }
}

function isUsageFailure(error: unknown): boolean {
  return error instanceof UsageError || (error instanceof Error && error.name === 'CACError');
}

function isCancellationFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError') return true;
  return 'code' in error && error.code === 'CAPTURE_CANCELLED';
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function configureCli(action: (url: unknown, options: RawPullOptions) => Promise<void>): CAC {
  const cli = cac('sitepull');
  cli
    .command('pull <url>', 'Render, inspect, and package a browser-delivered website')
    .option('-o, --output <directory>', 'Output root (default: ~/Sitepull)')
    .option('-d, --depth <number>', 'Maximum route depth (default: 2)')
    .option('-p, --max-pages <number>', 'Maximum pages to crawl (default: 25)')
    .option('--engine <engine>', 'Rendering engine: webkit, chromium, or firefox')
    .option('--viewports <presets>', 'Comma-separated presets: desktop,mobile,tablet')
    .option('--include-subdomains', 'Permit crawling subdomains of the source host')
    .option('--headed', 'Show the Playwright browser while capturing')
    .option('--headless', 'Run without a visible browser window (the default)')
    .option('--timeout <seconds>', 'Per-page timeout in seconds (default: 30)')
    .option('--zip', 'Export a ZIP after capture')
    .option('--ai-pack', 'With --zip, export the compact AI Pack instead of the full capture')
    .option('--quiet', 'Suppress progress and the human-readable summary')
    .example('  sitepull pull example.com')
    .example(
      '  sitepull pull example.com --headless --depth 2 --max-pages 25 --viewports desktop,mobile --ai-pack --zip',
    )
    .action(action);
  cli.help();
  cli.version(SITEPULL_VERSION);
  return cli;
}

function rawArgumentPresent(argv: readonly string[], ...values: readonly string[]): boolean {
  return argv.slice(2).some((argument) => values.includes(argument));
}

export async function runCli(argv: readonly string[], runtime: CliRuntime = {}): Promise<number> {
  const io = runtime.io ?? DEFAULT_IO;
  const signals = runtime.signals ?? DEFAULT_SIGNALS;
  const dependencies = runtime.pullDependencies ?? DEFAULT_PULL_DEPENDENCIES;
  let activeController: AbortController | undefined;
  let quiet = false;

  const cli = configureCli(async (url, rawOptions) => {
    const command = parsePullCommand(url, rawOptions);
    quiet = command.quiet;
    const controller = new AbortController();
    activeController = controller;
    const removeSigint = signals.onceSigint(() => {
      if (controller.signal.aborted) return;
      if (!quiet) io.writeStderr('! Cancellation requested; stopping Sitepull safely.\n');
      controller.abort();
    });

    try {
      const result = await executePull(command, controller.signal, io.writeStderr, dependencies);
      io.writeStdout(`${result.finalPath}\n`);
    } finally {
      removeSigint();
    }
  });

  try {
    captureConsoleInfo(io.writeStdout, () => cli.parse([...argv], { run: false }));
    const requestedHelp = rawArgumentPresent(argv, '-h', '--help');
    const requestedVersion = rawArgumentPresent(argv, '-v', '--version');
    if (requestedHelp) return 0;
    if (requestedVersion) {
      if (cli.matchedCommandName !== undefined) {
        captureConsoleInfo(io.writeStdout, () => cli.outputVersion());
      }
      return 0;
    }
    if (argv.length <= 2) {
      captureConsoleInfo(io.writeStdout, () => cli.outputHelp());
      return 0;
    }
    if (cli.matchedCommand === undefined) {
      throw new UsageError(`Unknown command "${argv[2] ?? ''}".`);
    }

    await cli.runMatchedCommand();
    return 0;
  } catch (error) {
    if (isUsageFailure(error)) {
      io.writeStderr(`Error: ${messageFor(error)}\n\nRun "sitepull pull --help" for usage.\n`);
      return 2;
    }
    if (activeController?.signal.aborted === true || isCancellationFailure(error)) {
      if (!quiet) io.writeStderr('! Sitepull cancelled.\n');
      return 130;
    }
    io.writeStderr(`Error: ${messageFor(error)}\n`);
    return 1;
  }
}
