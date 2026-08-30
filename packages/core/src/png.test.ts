import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  isPngPixelCountWithinLimit,
  MAX_SCREENSHOT_DECODED_PIXELS,
  parsePngIhdrDimensions,
  readPngIhdrDimensions,
} from './png.js';

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

describe('PNG decoded-pixel validation', () => {
  it('parses a structurally valid IHDR and reads only its fixed file prefix', async () => {
    const header = pngHeader(1_440, 27_777);
    expect(parsePngIhdrDimensions(header)).toEqual({ width: 1_440, height: 27_777 });

    const root = path.join(os.tmpdir(), `sitepull-png-${crypto.randomUUID()}`);
    temporaryRoots.push(root);
    await mkdir(root);
    const filePath = path.join(root, 'capture.png');
    await writeFile(filePath, Buffer.concat([header, Buffer.alloc(1_024)]));
    await expect(readPngIhdrDimensions(filePath)).resolves.toEqual({
      width: 1_440,
      height: 27_777,
    });
  });

  it('rejects truncated, forged, malformed, and zero-dimension IHDR data', () => {
    expect(parsePngIhdrDimensions(pngHeader(20, 20).subarray(0, 32))).toBeNull();

    const forgedSignature = pngHeader(20, 20);
    forgedSignature[0] = 0;
    expect(parsePngIhdrDimensions(forgedSignature)).toBeNull();

    const wrongFirstChunk = pngHeader(20, 20);
    wrongFirstChunk.write('IDAT', 12, 'ascii');
    expect(parsePngIhdrDimensions(wrongFirstChunk)).toBeNull();

    const invalidChunkLength = pngHeader(20, 20);
    invalidChunkLength.writeUInt32BE(12, 8);
    expect(parsePngIhdrDimensions(invalidChunkLength)).toBeNull();

    expect(parsePngIhdrDimensions(pngHeader(0, 20))).toBeNull();
    expect(parsePngIhdrDimensions(pngHeader(20, 0))).toBeNull();
  });

  it('accepts the exact shared boundary and rejects one pixel beyond it', () => {
    expect(MAX_SCREENSHOT_DECODED_PIXELS).toBe(40_000_000);
    expect(isPngPixelCountWithinLimit({ width: 8_000, height: 5_000 })).toBe(true);
    expect(isPngPixelCountWithinLimit({ width: 8_000, height: 5_001 })).toBe(false);
  });

  it('rejects invalid limits and maximum uint32 dimensions without numeric overflow', () => {
    expect(isPngPixelCountWithinLimit({ width: 0xffff_ffff, height: 0xffff_ffff })).toBe(false);
    expect(isPngPixelCountWithinLimit({ width: 1.5, height: 2 })).toBe(false);
    expect(isPngPixelCountWithinLimit({ width: 1, height: 1 }, Number.MAX_SAFE_INTEGER + 1)).toBe(
      false,
    );
  });
});
