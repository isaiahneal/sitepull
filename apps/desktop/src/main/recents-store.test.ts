import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_CRAWL_CONFIG, RecentsIndexSchema, type CaptureRecipe } from '@sitepull/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { RecentsStore } from './recents-store.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sitepull-recents-'));
  temporaryRoots.push(root);
  return root;
}

function captureRecipe(outputDirectory: string): CaptureRecipe {
  return {
    url: 'https://example.com/',
    allowHttpFallback: true,
    outputDirectory,
    config: {
      ...DEFAULT_CRAWL_CONFIG,
      maxDepth: 4,
      viewports: DEFAULT_CRAWL_CONFIG.viewports.map((viewport) => ({ ...viewport })),
    },
  };
}

describe('RecentsStore', () => {
  it('writes a validated index atomically and marks externally deleted captures missing', async () => {
    const root = await temporaryRoot();
    const captureRoot = path.join(root, 'capture');
    const indexPath = path.join(root, 'Application Support', 'recents.json');
    await mkdir(captureRoot);
    const store = new RecentsStore(indexPath);
    const recipe = captureRecipe(root);

    await store.rememberRecipe(recipe);

    await store.upsert({
      captureId: 'capture-123',
      url: 'https://example.com/',
      hostname: 'example.com',
      capturedAt: '2026-08-30T12:00:00.000Z',
      outputPath: captureRoot,
      pageCount: 8,
      assetCount: 143,
      byteSize: 4_200_000,
      status: 'completed',
      availability: 'available',
      recipe,
    });

    const initial = await store.list();
    expect(initial.captures[0]?.availability).toBe('available');
    expect(initial.captures[0]?.recipe).toEqual(recipe);
    expect(initial.lastUsedRecipe).toEqual(recipe);
    await rm(captureRoot, { recursive: true });
    expect((await store.list()).captures[0]?.availability).toBe('missing');
    expect(
      RecentsIndexSchema.parse(JSON.parse(await readFile(indexPath, 'utf8'))).captures,
    ).toHaveLength(1);
  });

  it('recovers gracefully from an invalid local index', async () => {
    const root = await temporaryRoot();
    const indexPath = path.join(root, 'recents.json');
    await writeFile(indexPath, '{ definitely not valid JSON');

    await expect(new RecentsStore(indexPath).list()).resolves.toMatchObject({ captures: [] });
  });

  it('persists the last-used normalized recipe across store instances', async () => {
    const root = await temporaryRoot();
    const indexPath = path.join(root, 'recents.json');
    const recipe = captureRecipe(root);

    await new RecentsStore(indexPath).rememberRecipe(recipe);

    const restored = await new RecentsStore(indexPath).list();
    expect(restored.lastUsedRecipe).toEqual(recipe);
    expect(restored.lastUsedRecipe?.config.maxPages).toBe(25);
    expect(restored.captures).toEqual([]);
  });
});
