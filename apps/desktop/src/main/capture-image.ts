import { loadCore } from './core.js';

/** Rejects malformed or over-budget PNGs before Chromium is asked to decode them. */
export async function isCaptureScreenshotSafeToDecode(filePath: string): Promise<boolean> {
  const { isPngPixelCountWithinLimit, readPngIhdrDimensions } = await loadCore();
  const dimensions = await readPngIhdrDimensions(filePath);
  return dimensions !== null && isPngPixelCountWithinLimit(dimensions);
}
