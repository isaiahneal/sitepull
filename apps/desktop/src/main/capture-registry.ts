import { lstat, readFile, realpath, stat } from 'node:fs/promises';

import {
  CaptureManifestSchema,
  SafeRelativePathSchema,
  type CaptureManifest,
} from '@sitepull/contracts';

import { loadCore } from './core.js';
import { DesktopError } from './errors.js';

interface RegisteredCapture {
  readonly root: string;
  readonly device: number;
  readonly inode: number;
}

async function inspectCaptureRoot(root: string): Promise<RegisteredCapture> {
  const canonicalRoot = await realpath(root);
  const entry = await lstat(canonicalRoot);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new DesktopError({
      code: 'PATH_TRAVERSAL',
      message: 'The capture folder is not a trusted directory.',
      stage: 'validation',
    });
  }
  return { root: canonicalRoot, device: entry.dev, inode: entry.ino };
}

export class CaptureRegistry {
  readonly #captures = new Map<string, RegisteredCapture>();

  async registerCompleted(
    captureId: string,
    outputDirectory: string,
    manifest: CaptureManifest,
  ): Promise<void> {
    const parsedManifest = CaptureManifestSchema.parse(manifest);
    if (parsedManifest.captureId !== captureId) {
      throw new DesktopError({
        code: 'INTERNAL_ERROR',
        message: 'The completed capture identity did not match its manifest.',
        stage: 'building-project',
      });
    }
    this.#captures.set(captureId, await inspectCaptureRoot(outputDirectory));
  }

  async registerExisting(captureId: string, outputDirectory: string): Promise<boolean> {
    try {
      const record = await inspectCaptureRoot(outputDirectory);
      const { resolvePathWithoutSymlinks } = await loadCore();
      const manifestPath = await resolvePathWithoutSymlinks(record.root, 'manifest.json');
      const manifestStats = await stat(manifestPath);
      if (!manifestStats.isFile() || manifestStats.size > 25 * 1024 * 1024) return false;
      const manifest = CaptureManifestSchema.parse(
        JSON.parse(await readFile(manifestPath, 'utf8')),
      );
      if (manifest.captureId !== captureId) return false;
      this.#captures.set(captureId, record);
      return true;
    } catch {
      this.#captures.delete(captureId);
      return false;
    }
  }

  unregister(captureId: string): void {
    this.#captures.delete(captureId);
  }

  async rootFor(captureId: string): Promise<string> {
    const registered = this.#captures.get(captureId);
    if (registered === undefined) {
      throw new DesktopError({
        code: 'INTERNAL_ERROR',
        message: 'This capture is unavailable or is no longer registered.',
        stage: 'validation',
      });
    }

    try {
      const current = await lstat(registered.root);
      const canonical = await realpath(registered.root);
      if (
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        current.dev !== registered.device ||
        current.ino !== registered.inode ||
        canonical !== registered.root
      ) {
        throw new Error('Capture root identity changed');
      }
      return registered.root;
    } catch (error) {
      this.#captures.delete(captureId);
      throw new DesktopError({
        code: 'PATH_TRAVERSAL',
        message: 'The capture folder was moved, replaced, or deleted.',
        stage: 'validation',
        details: { cause: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  async resolveRelative(captureId: string, relativePath: string): Promise<string> {
    const parsedPath = SafeRelativePathSchema.parse(relativePath);
    const root = await this.rootFor(captureId);
    const { resolvePathWithoutSymlinks } = await loadCore();
    return resolvePathWithoutSymlinks(root, parsedPath);
  }

  async readManifest(captureId: string): Promise<CaptureManifest> {
    const manifestPath = await this.resolveRelative(captureId, 'manifest.json');
    const manifestStats = await stat(manifestPath);
    if (!manifestStats.isFile() || manifestStats.size > 25 * 1024 * 1024) {
      throw new DesktopError({
        code: 'INTERNAL_ERROR',
        message: 'The capture manifest is missing or unexpectedly large.',
        stage: 'validation',
      });
    }
    const manifest = CaptureManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
    if (manifest.captureId !== captureId) {
      throw new DesktopError({
        code: 'PATH_TRAVERSAL',
        message: 'The capture manifest identity does not match the registered folder.',
        stage: 'validation',
      });
    }
    return manifest;
  }
}
