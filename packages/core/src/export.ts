import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import { ZipArchive } from 'archiver';
import type { ExportMode } from '@sitepull/contracts';

import { throwIfAborted } from './async.js';
import { SitepullError } from './errors.js';
import { listFilesRecursively } from './project.js';
import { resolvePathWithinRoot } from './paths.js';

const AI_PACK_ROOT_FILES = new Set([
  'AI_CONTEXT.md',
  'README.md',
  'manifest.json',
  'sitepull.json',
]);
const COMPRESSED_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.woff',
  '.woff2',
  '.zip',
]);
const ASSET_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif']);

export interface ExportSelection {
  readonly files: readonly string[];
  readonly rawBytes: number;
  readonly estimatedCompressedBytes: number;
}

export interface ExportResult extends ExportSelection {
  readonly mode: ExportMode;
  readonly archivePath: string;
  readonly compressedBytes: number;
}

function isAiPackFile(relativePath: string): boolean {
  if (AI_PACK_ROOT_FILES.has(relativePath)) return true;
  if (relativePath.startsWith('design/')) return true;
  if (relativePath.startsWith('pages/')) {
    const basename = path.posix.basename(relativePath);
    if (relativePath.includes('/screenshots/')) return basename.endsWith('.png');
    return ['rendered.html', 'document.json', 'elements.json', 'links.json'].includes(basename);
  }
  if (relativePath.startsWith('assets/'))
    return ASSET_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase());
  return false;
}

function estimatedRatio(relativePath: string): number {
  const extension = path.posix.extname(relativePath).toLowerCase();
  if (COMPRESSED_EXTENSIONS.has(extension)) return 0.96;
  if (extension === '.svg' || extension === '.html' || extension === '.json' || extension === '.md')
    return 0.32;
  return 0.58;
}

export async function selectExportFiles(
  captureRoot: string,
  mode: ExportMode,
): Promise<ExportSelection> {
  const candidates = await listFilesRecursively(captureRoot);
  const files: string[] = [];
  let rawBytes = 0;
  let estimatedCompressedBytes = 0;
  let selectedAssetBytes = 0;

  for (const relativePath of candidates) {
    if (relativePath.endsWith('.zip')) continue;
    if (mode === 'ai-pack' && !isAiPackFile(relativePath)) continue;
    const file = resolvePathWithinRoot(captureRoot, relativePath);
    const size = (await stat(file)).size;
    if (mode === 'ai-pack' && relativePath.startsWith('assets/')) {
      if (size > 2 * 1024 * 1024 || selectedAssetBytes + size > 20 * 1024 * 1024) continue;
      selectedAssetBytes += size;
    }
    files.push(relativePath);
    rawBytes += size;
    estimatedCompressedBytes += Math.ceil(size * estimatedRatio(relativePath));
  }

  return { files: files.sort((a, b) => a.localeCompare(b)), rawBytes, estimatedCompressedBytes };
}

export async function exportCaptureArchive(options: {
  captureRoot: string;
  mode: ExportMode;
  destination?: string;
  signal?: AbortSignal;
}): Promise<ExportResult> {
  throwIfAborted(options.signal);
  const selection = await selectExportFiles(options.captureRoot, options.mode);
  const suffix = options.mode === 'ai-pack' ? 'ai-pack' : 'full-capture';
  const destination = path.resolve(
    options.destination ?? `${options.captureRoot.replace(/[\\/]$/u, '')}-${suffix}.zip`,
  );
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await stat(destination);
    throw new SitepullError({
      code: 'EXPORT_FAILED',
      message: `Refusing to overwrite an existing archive: ${destination}`,
      stage: 'packaging',
    });
  } catch (error) {
    if (error instanceof SitepullError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = `${destination}.partial`;
  await rm(temporary, { force: true });

  const archive = new ZipArchive({ zlib: { level: 9 } });
  const output = createWriteStream(temporary, { flags: 'wx' });
  const abort = (): void => {
    archive.abort();
    output.destroy(new Error('Capture export cancelled'));
  };
  options.signal?.addEventListener('abort', abort, { once: true });

  try {
    const completion = pipeline(archive, output);
    for (const relativePath of selection.files) {
      throwIfAborted(options.signal);
      const absolute = resolvePathWithinRoot(options.captureRoot, relativePath);
      archive.file(absolute, { name: relativePath });
    }
    await archive.finalize();
    await completion;
    const { rename } = await import('node:fs/promises');
    await rename(temporary, destination);
    const compressedBytes = (await stat(destination)).size;
    return { ...selection, mode: options.mode, archivePath: destination, compressedBytes };
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    if (options.signal?.aborted === true) {
      throw new SitepullError({
        code: 'CAPTURE_CANCELLED',
        message: 'Capture export was cancelled.',
        cause: error,
      });
    }
    throw new SitepullError({
      code: 'EXPORT_FAILED',
      message: `Could not create ${options.mode === 'ai-pack' ? 'AI Pack' : 'Full Capture'} ZIP.`,
      stage: 'packaging',
      retryable: true,
      cause: error,
    });
  } finally {
    options.signal?.removeEventListener('abort', abort);
  }
}
