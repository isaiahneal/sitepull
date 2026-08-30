import type { CaptureEvent, CaptureResultSummary, ExportMode } from '@sitepull/contracts';

export type TextWriter = (text: string) => void;

const STAGE_LABELS = {
  'normalizing-url': 'Validating URL',
  'launching-browser': 'Launching browser',
  rendering: 'Rendering',
  'discovering-routes': 'Discovering routes',
  'crawling-pages': 'Crawling pages',
  'capturing-assets': 'Capturing assets',
  'extracting-styles': 'Extracting styles',
  'analyzing-design-system': 'Analyzing design system',
  'building-ai-pack': 'Building AI context',
  packaging: 'Packaging',
} as const;

export function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes / 1_024;
  let unitIndex = 0;
  while (value >= 1_024 && unitIndex < units.length - 1) {
    value /= 1_024;
    unitIndex += 1;
  }
  const precision = value >= 10 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function summaryRow(label: string, value: string): string {
  return `${label.padEnd(16)}${value}`;
}

export class ProgressReporter {
  readonly #write: TextWriter;
  readonly #quiet: boolean;

  constructor(write: TextWriter, quiet: boolean) {
    this.#write = write;
    this.#quiet = quiet;
  }

  start(): void {
    if (!this.#quiet) this.#write('SITEPULL\n\n');
  }

  onEvent(event: CaptureEvent): void {
    if (this.#quiet) return;
    if (event.type === 'progress') {
      const glyph = event.state === 'completed' ? '✓' : '●';
      const label = STAGE_LABELS[event.stage];
      this.#write(`${glyph} ${label} — ${event.message}\n`);
      return;
    }
    if (event.type === 'log' && (event.level === 'warn' || event.level === 'error')) {
      this.#write(`! ${event.message}\n`);
    }
  }

  packaging(mode: ExportMode): void {
    if (!this.#quiet) {
      this.#write(`● Packaging ${mode === 'ai-pack' ? 'AI Pack' : 'Full Capture'}\n`);
    }
  }

  packagingComplete(mode: ExportMode, compressedBytes: number): void {
    if (!this.#quiet) {
      this.#write(
        `✓ Packaged ${mode === 'ai-pack' ? 'AI Pack' : 'Full Capture'} (${formatBytes(compressedBytes)})\n`,
      );
    }
  }

  complete(summary: CaptureResultSummary, archivePath: string | null): void {
    if (this.#quiet) return;
    this.#write(
      [
        '',
        '✓ Sitepull complete',
        '',
        summaryRow('Routes', String(summary.counts.pages)),
        summaryRow('Assets', String(summary.counts.assets)),
        summaryRow('Components', `${summary.counts.components} candidates`),
        summaryRow('Captured', formatBytes(summary.counts.bytes)),
        ...(archivePath === null ? [] : [summaryRow('Archive', archivePath)]),
        '',
      ].join('\n'),
    );
  }
}
