import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import { dialog, type BrowserWindow } from 'electron';
import {
  OutputDirectorySelectionResultSchema,
  type OutputDirectorySelectionResult,
} from '@sitepull/contracts';

import { DesktopError } from './errors.js';

async function canonicalDirectory(directory: string, create: boolean): Promise<string> {
  const absolute = path.resolve(directory);
  if (create) await mkdir(absolute, { recursive: true });
  const original = await lstat(absolute);
  if (!original.isDirectory() || original.isSymbolicLink()) {
    throw new DesktopError({
      code: 'OUTPUT_NOT_WRITABLE',
      message: 'The selected output location is not a trusted directory.',
      stage: 'validation',
    });
  }
  return realpath(absolute);
}

export class OutputAuthorization {
  readonly #authorized = new Set<string>();
  readonly #defaultDirectory: string;

  private constructor(defaultDirectory: string) {
    this.#defaultDirectory = defaultDirectory;
    this.#authorized.add(defaultDirectory);
  }

  static async create(
    defaultDirectory: string,
    persistedDirectories: readonly string[] = [],
  ): Promise<OutputAuthorization> {
    const authorization = new OutputAuthorization(await canonicalDirectory(defaultDirectory, true));
    for (const directory of new Set(persistedDirectories)) {
      try {
        authorization.#authorized.add(await canonicalDirectory(directory, false));
      } catch {
        // A moved or unavailable persisted output is surfaced when the user
        // attempts to capture again; it must not prevent the app from opening.
      }
    }
    return authorization;
  }

  async select(window: BrowserWindow): Promise<OutputDirectorySelectionResult> {
    const selection = await dialog.showOpenDialog(window, {
      title: 'Choose Sitepull output folder',
      buttonLabel: 'Use This Folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (selection.canceled || selection.filePaths[0] === undefined) {
      return OutputDirectorySelectionResultSchema.parse({ cancelled: true, path: null });
    }

    const selected = await canonicalDirectory(selection.filePaths[0], false);
    this.#authorized.add(selected);
    return OutputDirectorySelectionResultSchema.parse({ cancelled: false, path: selected });
  }

  async resolve(requested: string | undefined): Promise<string> {
    if (requested === undefined) return this.#defaultDirectory;

    let canonical: string;
    try {
      canonical = await canonicalDirectory(requested, false);
    } catch {
      throw new DesktopError({
        code: 'OUTPUT_NOT_WRITABLE',
        message: 'The requested output folder is unavailable.',
        stage: 'validation',
      });
    }
    if (!this.#authorized.has(canonical)) {
      throw new DesktopError({
        code: 'OUTPUT_NOT_WRITABLE',
        message: 'Choose the output folder with Sitepull before starting a capture.',
        stage: 'validation',
      });
    }
    return canonical;
  }
}
