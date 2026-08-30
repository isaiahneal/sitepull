import { mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ProjectWriter, directoryByteSize, listFilesRecursively } from './project.js';

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('ProjectWriter', () => {
  it('writes only below its owned staging directory and finalizes atomically', async () => {
    const root = path.join(os.tmpdir(), `sitepull-project-${crypto.randomUUID()}`);
    roots.push(root);
    await mkdir(root);
    const writer = await ProjectWriter.create(
      root,
      'https://example.com',
      new Date('2026-08-30T12:00:00Z'),
    );
    await writer.writeText('pages/home/rendered.html', '<main>Ready</main>');
    await writer.writeJson('manifest.json', { ok: true });
    await expect(writer.writeText('../escape.txt', 'no')).rejects.toMatchObject({
      code: 'PATH_TRAVERSAL',
    });
    const finalPath = await writer.finalize();
    expect(await readFile(path.join(finalPath, 'pages/home/rendered.html'), 'utf8')).toBe(
      '<main>Ready</main>',
    );
    expect(await listFilesRecursively(finalPath)).toEqual([
      'manifest.json',
      'pages/home/rendered.html',
    ]);
    expect(await directoryByteSize(finalPath)).toBeGreaterThan(10);
  });

  it('removes only its recognizable staging directory on cancellation', async () => {
    const root = path.join(os.tmpdir(), `sitepull-project-${crypto.randomUUID()}`);
    roots.push(root);
    await mkdir(root);
    const writer = await ProjectWriter.create(root, 'https://example.com');
    await writer.writeText('logs/sitepull.jsonl', 'started\n');
    await writer.cleanupCancelled();
    await expect(readFile(writer.stagingRoot, 'utf8')).rejects.toBeDefined();
  });
});
