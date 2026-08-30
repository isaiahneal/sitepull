import { open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { clipboard, shell } from 'electron';
import {
  FilePreviewResultSchema,
  SystemActionResultSchema,
  type FilePreviewResult,
  type ReadCaptureFilePayload,
  type SystemActionResult,
} from '@sitepull/contracts';

import type { CaptureRegistry } from './capture-registry.js';
import { DesktopError } from './errors.js';

const PREVIEW_LANGUAGES = new Map<string, string>([
  ['.css', 'css'],
  ['.html', 'html'],
  ['.js', 'javascript'],
  ['.json', 'json'],
  ['.jsonl', 'json'],
  ['.map', 'json'],
  ['.md', 'markdown'],
  ['.mjs', 'javascript'],
  ['.svg', 'xml'],
  ['.txt', 'plaintext'],
  ['.xml', 'xml'],
  ['.yaml', 'yaml'],
  ['.yml', 'yaml'],
]);

function languageFor(relativePath: string): string | null {
  return PREVIEW_LANGUAGES.get(path.extname(relativePath).toLowerCase()) ?? null;
}

function decodeUtf8(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new DesktopError({
      code: 'INTERNAL_ERROR',
      message: 'This file is binary or is not valid UTF-8 text.',
      stage: 'validation',
    });
  }
}

export async function readCaptureFile(
  registry: CaptureRegistry,
  payload: ReadCaptureFilePayload,
): Promise<FilePreviewResult> {
  const language = languageFor(payload.relativePath);
  if (language === null) {
    throw new DesktopError({
      code: 'INTERNAL_ERROR',
      message: 'Sitepull does not preview this binary file type as text.',
      stage: 'validation',
    });
  }

  const filePath = await registry.resolveRelative(payload.captureId, payload.relativePath);
  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) {
    throw new DesktopError({
      code: 'INTERNAL_ERROR',
      message: 'The requested capture file is unavailable.',
      stage: 'validation',
    });
  }

  const bytesToRead = Math.min(fileStats.size, payload.maxBytes);
  const handle = await open(filePath, 'r');
  let content: Buffer;
  try {
    content = Buffer.alloc(bytesToRead);
    await handle.read(content, 0, bytesToRead, 0);
  } finally {
    await handle.close();
  }

  return FilePreviewResultSchema.parse({
    relativePath: payload.relativePath,
    content: decodeUtf8(content),
    byteSize: fileStats.size,
    truncated: fileStats.size > payload.maxBytes,
    language,
  });
}

export async function copyAiContext(
  registry: CaptureRegistry,
  captureId: string,
): Promise<SystemActionResult> {
  const contextPath = await registry.resolveRelative(captureId, 'AI_CONTEXT.md');
  const contextStats = await stat(contextPath);
  if (!contextStats.isFile() || contextStats.size > 5 * 1024 * 1024) {
    throw new DesktopError({
      code: 'INTERNAL_ERROR',
      message: 'AI_CONTEXT.md is missing or unexpectedly large.',
      stage: 'validation',
    });
  }
  await clipboard.writeText(await readFile(contextPath, 'utf8'));
  return SystemActionResultSchema.parse({ completed: true });
}

export async function openCaptureFolder(
  registry: CaptureRegistry,
  captureId: string,
): Promise<SystemActionResult> {
  const root = await registry.rootFor(captureId);
  const errorMessage = await shell.openPath(root);
  if (errorMessage !== '') {
    throw new DesktopError({
      code: 'INTERNAL_ERROR',
      message: `The system file browser could not open the capture folder: ${errorMessage}`,
      stage: 'validation',
    });
  }
  return SystemActionResultSchema.parse({ completed: true });
}

export async function revealCaptureInFinder(
  registry: CaptureRegistry,
  captureId: string,
): Promise<SystemActionResult> {
  shell.showItemInFolder(await registry.rootFor(captureId));
  return SystemActionResultSchema.parse({ completed: true });
}
