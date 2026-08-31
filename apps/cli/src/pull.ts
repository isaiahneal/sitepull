import type {
  CaptureEvent,
  CaptureResultSummary,
  CrawlConfigInput,
  ExportMode,
} from '@sitepull/contracts';
import { exportCaptureArchive, runCapture } from '@sitepull/core';

import type { ParsedPullCommand } from './options.js';
import { ProgressReporter, type TextWriter } from './progress.js';

interface CaptureExecutionResult {
  readonly outputDirectory: string;
  readonly summary: CaptureResultSummary;
}

interface ArchiveExecutionResult {
  readonly archivePath: string;
  readonly compressedBytes: number;
}

export interface PullDependencies {
  readonly runCapture: (
    input: {
      readonly url: string;
      readonly outputDirectory: string;
      readonly config?: CrawlConfigInput;
      readonly allowHttpFallback?: boolean;
    },
    options?: {
      readonly signal?: AbortSignal;
      readonly onEvent?: (event: CaptureEvent) => void;
      readonly chromiumExecutablePath?: string;
    },
  ) => Promise<CaptureExecutionResult>;
  readonly exportCaptureArchive: (options: {
    readonly captureRoot: string;
    readonly mode: ExportMode;
    readonly signal?: AbortSignal;
  }) => Promise<ArchiveExecutionResult>;
}

export interface PullExecutionResult {
  readonly finalPath: string;
  readonly capture: CaptureExecutionResult;
  readonly archive: ArchiveExecutionResult | null;
}

export const DEFAULT_PULL_DEPENDENCIES: PullDependencies = {
  runCapture,
  exportCaptureArchive,
};

export async function executePull(
  command: ParsedPullCommand,
  signal: AbortSignal,
  writeProgress: TextWriter,
  dependencies: PullDependencies = DEFAULT_PULL_DEPENDENCIES,
  chromiumExecutablePath?: string,
): Promise<PullExecutionResult> {
  const reporter = new ProgressReporter(writeProgress, command.quiet);
  reporter.start();
  const capture = await dependencies.runCapture(
    {
      url: command.request.url,
      outputDirectory: command.request.outputDirectory,
      config: command.request.config,
      allowHttpFallback: command.allowHttpFallback,
    },
    {
      signal,
      onEvent: (event) => reporter.onEvent(event),
      ...(chromiumExecutablePath === undefined ? {} : { chromiumExecutablePath }),
    },
  );

  let archive: ArchiveExecutionResult | null = null;
  if (command.exportMode !== null) {
    reporter.packaging(command.exportMode);
    archive = await dependencies.exportCaptureArchive({
      captureRoot: capture.outputDirectory,
      mode: command.exportMode,
      signal,
    });
    reporter.packagingComplete(command.exportMode, archive.compressedBytes);
  }

  reporter.complete(capture.summary, archive?.archivePath ?? null);
  return {
    finalPath: archive?.archivePath ?? capture.outputDirectory,
    capture,
    archive,
  };
}
