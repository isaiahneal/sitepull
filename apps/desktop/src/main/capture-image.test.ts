import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { MAX_SCREENSHOT_DECODED_PIXELS } from '@sitepull/core';
import { afterEach, describe, expect, it } from 'vitest';

import { isCaptureScreenshotSafeToDecode } from './capture-image.js';

const temporaryRoots: string[] = [];

function pngHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'ascii');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  header[24] = 8;
  header[25] = 6;
  return header;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function writeScreenshot(contents: Uint8Array): Promise<string> {
  const root = path.join(os.tmpdir(), `sitepull-protocol-png-${crypto.randomUUID()}`);
  temporaryRoots.push(root);
  await mkdir(root);
  const filePath = path.join(root, 'desktop.png');
  await writeFile(filePath, contents);
  return filePath;
}

describe('capture screenshot protocol decode guard', () => {
  it('uses the shared 40-million-pixel boundary', async () => {
    expect(MAX_SCREENSHOT_DECODED_PIXELS).toBe(40_000_000);
    await expect(
      isCaptureScreenshotSafeToDecode(await writeScreenshot(pngHeader(8_000, 5_000))),
    ).resolves.toBe(true);
    await expect(
      isCaptureScreenshotSafeToDecode(await writeScreenshot(pngHeader(8_000, 5_001))),
    ).resolves.toBe(false);
  });

  it('rejects invalid PNG input before protocol delivery', async () => {
    await expect(
      isCaptureScreenshotSafeToDecode(await writeScreenshot(Buffer.from('not a png'))),
    ).resolves.toBe(false);
    await expect(
      isCaptureScreenshotSafeToDecode(await writeScreenshot(pngHeader(0, 100))),
    ).resolves.toBe(false);
  });
});
