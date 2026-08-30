import { access, mkdir, opendir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { randomBytes } from 'node:crypto';

import { sanitizeFilename, resolvePathWithinRoot } from './paths.js';
import { SitepullError } from './errors.js';

function captureTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/u, 'Z')
    .replaceAll(':', '-');
}

function captureIdentifier(hostname: string, startedAt: Date): string {
  const host = sanitizeFilename(hostname.toLowerCase(), { fallback: 'site', maxLength: 80 });
  return `${host}-${captureTimestamp(startedAt)}-${randomBytes(3).toString('hex')}`;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function availableFinalPath(outputRoot: string, basename: string): Promise<string> {
  for (let suffix = 1; suffix < 1_000; suffix += 1) {
    const candidateName = suffix === 1 ? basename : `${basename}-${suffix}`;
    const candidate = resolvePathWithinRoot(outputRoot, candidateName);
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new SitepullError({
    code: 'OUTPUT_NOT_WRITABLE',
    message: 'Could not choose a unique capture directory name.',
    stage: 'building-project',
  });
}

export class ProjectWriter {
  readonly outputRoot: string;
  readonly stagingRoot: string;
  readonly captureId: string;
  readonly finalBasename: string;
  #finalized = false;

  private constructor(options: {
    outputRoot: string;
    stagingRoot: string;
    captureId: string;
    finalBasename: string;
  }) {
    this.outputRoot = options.outputRoot;
    this.stagingRoot = options.stagingRoot;
    this.captureId = options.captureId;
    this.finalBasename = options.finalBasename;
  }

  static async create(
    outputDirectory: string,
    sourceUrl: string,
    startedAt = new Date(),
  ): Promise<ProjectWriter> {
    const outputRoot = path.resolve(outputDirectory);
    try {
      await mkdir(outputRoot, { recursive: true });
      await access(outputRoot, constants.W_OK | constants.R_OK);
    } catch (error) {
      throw new SitepullError({
        code: 'OUTPUT_NOT_WRITABLE',
        message: `Output directory is not writable: ${outputRoot}`,
        stage: 'building-project',
        details: { outputRoot },
        cause: error,
      });
    }

    const hostname = new URL(sourceUrl).hostname;
    const captureId = captureIdentifier(hostname, startedAt);
    const finalBasename = `${sanitizeFilename(hostname, { fallback: 'site', maxLength: 100 })}-${captureTimestamp(startedAt)}-${captureId.slice(-6)}`;
    const stagingRoot = resolvePathWithinRoot(outputRoot, `.sitepull-${captureId}.partial`);
    if (await pathExists(stagingRoot)) {
      throw new SitepullError({
        code: 'OUTPUT_NOT_WRITABLE',
        message: `A staging directory already exists for capture ${captureId}.`,
        stage: 'building-project',
      });
    }
    await mkdir(stagingRoot, { recursive: false });
    return new ProjectWriter({ outputRoot, stagingRoot, captureId, finalBasename });
  }

  resolve(relativePath: string): string {
    return resolvePathWithinRoot(this.stagingRoot, relativePath);
  }

  get plannedFinalPath(): string {
    return resolvePathWithinRoot(this.outputRoot, this.finalBasename);
  }

  async ensureDirectory(relativePath: string): Promise<string> {
    const destination = this.resolve(relativePath);
    await mkdir(destination, { recursive: true });
    return destination;
  }

  async writeText(relativePath: string, content: string | Uint8Array): Promise<string> {
    const destination = this.resolve(relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.tmp-${randomBytes(3).toString('hex')}`;
    await writeFile(temporary, content);
    await rename(temporary, destination);
    return destination;
  }

  async writeJson(relativePath: string, value: unknown): Promise<string> {
    return this.writeText(relativePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  async readText(relativePath: string): Promise<string> {
    return readFile(this.resolve(relativePath), 'utf8');
  }

  async finalize(): Promise<string> {
    if (this.#finalized) {
      throw new SitepullError({
        code: 'INTERNAL_ERROR',
        message: 'This capture project was already finalized.',
        stage: 'building-project',
      });
    }
    const destination = this.plannedFinalPath;
    if (await pathExists(destination)) {
      throw new SitepullError({
        code: 'OUTPUT_NOT_WRITABLE',
        message: `Capture destination already exists: ${destination}`,
        stage: 'building-project',
      });
    }
    await rename(this.stagingRoot, destination);
    this.#finalized = true;
    return destination;
  }

  async preserveFailed(): Promise<string> {
    if (this.#finalized) return this.stagingRoot;
    const destination = await availableFinalPath(this.outputRoot, `${this.finalBasename}-failed`);
    await rename(this.stagingRoot, destination);
    this.#finalized = true;
    return destination;
  }

  async cleanupCancelled(): Promise<void> {
    if (this.#finalized) return;
    const relation = path.relative(this.outputRoot, this.stagingRoot);
    if (
      !relation.startsWith('.sitepull-') ||
      !relation.endsWith('.partial') ||
      relation.includes(path.sep)
    ) {
      throw new SitepullError({
        code: 'PATH_TRAVERSAL',
        message: 'Refused to clean an unrecognized staging directory.',
        stage: 'building-project',
      });
    }
    await rm(this.stagingRoot, { recursive: true, force: true });
    this.#finalized = true;
  }
}

export async function listFilesRecursively(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const handle = await opendir(directory);
    for await (const entry of handle) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join('/'));
    }
  };
  await visit(path.resolve(root));
  return files.sort((a, b) => a.localeCompare(b));
}

export async function directoryByteSize(root: string): Promise<number> {
  let bytes = 0;
  for (const relativePath of await listFilesRecursively(root)) {
    bytes += (await stat(resolvePathWithinRoot(root, relativePath))).size;
  }
  return bytes;
}
