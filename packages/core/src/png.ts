import { open } from 'node:fs/promises';

const PNG_IHDR_TOTAL_BYTES = 33;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const IHDR_CHUNK_TYPE = [73, 72, 68, 82] as const;

/**
 * Maximum decoded pixels in a persisted or renderer-served screenshot.
 * A 32-bit RGBA decode at this boundary occupies about 160 MB.
 */
export const MAX_SCREENSHOT_DECODED_PIXELS = 40_000_000;

export interface PngDimensions {
  readonly width: number;
  readonly height: number;
}

function bytesMatch(input: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => input[offset + index] === value);
}

function hasValidIhdrEncoding(input: Uint8Array): boolean {
  const bitDepth = input[24];
  const colorType = input[25];
  const validBitDepth =
    (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth ?? -1)) ||
    (colorType === 2 && [8, 16].includes(bitDepth ?? -1)) ||
    (colorType === 3 && [1, 2, 4, 8].includes(bitDepth ?? -1)) ||
    (colorType === 4 && [8, 16].includes(bitDepth ?? -1)) ||
    (colorType === 6 && [8, 16].includes(bitDepth ?? -1));

  return (
    validBitDepth && input[26] === 0 && input[27] === 0 && (input[28] === 0 || input[28] === 1)
  );
}

/**
 * Parses the fixed PNG signature and first IHDR chunk without decoding image data.
 * Payload chunks and CRCs remain the responsibility of the eventual image decoder.
 */
export function parsePngIhdrDimensions(input: Uint8Array): PngDimensions | null {
  if (
    input.byteLength < PNG_IHDR_TOTAL_BYTES ||
    !bytesMatch(input, 0, PNG_SIGNATURE) ||
    !bytesMatch(input, 12, IHDR_CHUNK_TYPE) ||
    !hasValidIhdrEncoding(input)
  ) {
    return null;
  }

  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (view.getUint32(8, false) !== 13) return null;

  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width === 0 || height === 0) return null;
  return { width, height };
}

/** Checks decoded pixel area using bigint arithmetic so hostile dimensions cannot overflow. */
export function isPngPixelCountWithinLimit(
  dimensions: PngDimensions,
  maximumPixels = MAX_SCREENSHOT_DECODED_PIXELS,
): boolean {
  const { width, height } = dimensions;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 0xffff_ffff ||
    height > 0xffff_ffff ||
    !Number.isSafeInteger(maximumPixels) ||
    maximumPixels <= 0
  ) {
    return false;
  }

  return BigInt(width) * BigInt(height) <= BigInt(maximumPixels);
}

/** Reads only the fixed PNG/IHDR prefix needed for decoded-pixel validation. */
export async function readPngIhdrDimensions(filePath: string): Promise<PngDimensions | null> {
  const handle = await open(filePath, 'r');
  try {
    const header = Buffer.alloc(PNG_IHDR_TOTAL_BYTES);
    const { bytesRead } = await handle.read(header, 0, header.byteLength, 0);
    return parsePngIhdrDimensions(header.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}
