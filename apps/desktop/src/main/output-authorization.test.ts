import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ dialog: { showOpenDialog: vi.fn() } }));

import { OutputAuthorization } from './output-authorization.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('OutputAuthorization persisted recipes', () => {
  it('restores only existing directories that were persisted by Sitepull', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sitepull-output-auth-'));
    temporaryRoots.push(root);
    const defaultDirectory = path.join(root, 'default');
    const persistedDirectory = path.join(root, 'persisted');
    const unrelatedDirectory = path.join(root, 'unrelated');
    await Promise.all([mkdir(persistedDirectory), mkdir(unrelatedDirectory)]);

    const authorization = await OutputAuthorization.create(defaultDirectory, [
      persistedDirectory,
      path.join(root, 'no-longer-present'),
    ]);

    await expect(authorization.resolve(undefined)).resolves.toBe(await realpath(defaultDirectory));
    await expect(authorization.resolve(persistedDirectory)).resolves.toBe(
      await realpath(persistedDirectory),
    );
    await expect(authorization.resolve(unrelatedDirectory)).rejects.toThrow(
      /Choose the output folder/u,
    );
  });
});
