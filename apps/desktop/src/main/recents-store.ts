import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  CaptureRecipeSchema,
  RecentCaptureSchema,
  RecentsIndexSchema,
  type CaptureRecipe,
  type RecentCapture,
  type RecentsIndex,
} from '@sitepull/contracts';

const MAX_RECENTS = 100;
const MAX_INDEX_BYTES = 2 * 1024 * 1024;

function emptyIndex(): RecentsIndex {
  return RecentsIndexSchema.parse({
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    lastUsedRecipe: null,
    captures: [],
  });
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

async function captureAvailability(outputPath: string): Promise<'available' | 'missing'> {
  try {
    const entry = await lstat(outputPath);
    return entry.isDirectory() && !entry.isSymbolicLink() ? 'available' : 'missing';
  } catch {
    return 'missing';
  }
}

export class RecentsStore {
  readonly #indexPath: string;
  #queue: Promise<void> = Promise.resolve();

  constructor(indexPath: string) {
    this.#indexPath = path.resolve(indexPath);
  }

  async list(): Promise<RecentsIndex> {
    return this.#exclusive(async () => {
      const index = await this.#readUnlocked();
      let changed = false;
      const captures: RecentCapture[] = [];
      for (const capture of index.captures) {
        const availability = await captureAvailability(capture.outputPath);
        changed ||= availability !== capture.availability;
        captures.push(RecentCaptureSchema.parse({ ...capture, availability }));
      }
      const refreshed = RecentsIndexSchema.parse({
        ...index,
        updatedAt: changed ? new Date().toISOString() : index.updatedAt,
        captures,
      });
      if (changed) await this.#writeUnlocked(refreshed);
      return refreshed;
    });
  }

  async upsert(capture: RecentCapture): Promise<RecentsIndex> {
    const parsedCapture = RecentCaptureSchema.parse(capture);
    return this.#exclusive(async () => {
      const index = await this.#readUnlocked();
      const captures = [
        parsedCapture,
        ...index.captures.filter((entry) => entry.captureId !== parsedCapture.captureId),
      ]
        .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt))
        .slice(0, MAX_RECENTS);
      const next = RecentsIndexSchema.parse({
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        lastUsedRecipe: index.lastUsedRecipe,
        captures,
      });
      await this.#writeUnlocked(next);
      return next;
    });
  }

  async rememberRecipe(recipe: CaptureRecipe): Promise<RecentsIndex> {
    const parsedRecipe = CaptureRecipeSchema.parse(recipe);
    return this.#exclusive(async () => {
      const index = await this.#readUnlocked();
      const next = RecentsIndexSchema.parse({
        ...index,
        updatedAt: new Date().toISOString(),
        lastUsedRecipe: parsedRecipe,
      });
      await this.#writeUnlocked(next);
      return next;
    });
  }

  #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation);
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #readUnlocked(): Promise<RecentsIndex> {
    try {
      const indexStats = await stat(this.#indexPath);
      if (!indexStats.isFile() || indexStats.size > MAX_INDEX_BYTES) return emptyIndex();
      const parsed = RecentsIndexSchema.safeParse(
        parseJson(await readFile(this.#indexPath, 'utf8')),
      );
      return parsed.success ? parsed.data : emptyIndex();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyIndex();
      if (error instanceof SyntaxError) return emptyIndex();
      throw error;
    }
  }

  async #writeUnlocked(index: RecentsIndex): Promise<void> {
    await mkdir(path.dirname(this.#indexPath), { recursive: true });
    const temporaryPath = `${this.#indexPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(index, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      await rename(temporaryPath, this.#indexPath);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}
