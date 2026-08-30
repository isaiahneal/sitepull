import { CaptureIdSchema, SafeRelativePathSchema } from '@sitepull/contracts';

export const CAPTURE_SCHEME = 'sitepull-capture';
const SCREENSHOT_PATH =
  /^pages\/[A-Za-z0-9][A-Za-z0-9._-]*\/screenshots\/[A-Za-z0-9][A-Za-z0-9._-]*\.png$/u;

export interface CaptureScreenshotRequest {
  readonly captureId: string;
  readonly relativePath: string;
}

function decodeSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    if (
      decoded.length === 0 ||
      decoded === '.' ||
      decoded === '..' ||
      decoded.includes('/') ||
      decoded.includes('\\')
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

/** Parses only sitepull-capture://capture/<id>/<encoded screenshot path segments>. */
export function parseCaptureScreenshotUrl(input: string): CaptureScreenshotRequest | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (
    url.protocol !== `${CAPTURE_SCHEME}:` ||
    url.hostname !== 'capture' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return null;
  }

  const rawSegments = url.pathname.split('/').slice(1);
  if (rawSegments.length < 5) return null;
  const segments = rawSegments.map(decodeSegment);
  if (segments.some((segment) => segment === null)) return null;

  const decodedSegments = segments as string[];
  const captureIdResult = CaptureIdSchema.safeParse(decodedSegments[0]);
  if (!captureIdResult.success) return null;
  const relativePathResult = SafeRelativePathSchema.safeParse(decodedSegments.slice(1).join('/'));
  if (!relativePathResult.success || !SCREENSHOT_PATH.test(relativePathResult.data)) return null;

  return {
    captureId: captureIdResult.data,
    relativePath: relativePathResult.data,
  };
}
