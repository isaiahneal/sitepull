import { describe, expect, it } from 'vitest';

import { parseCaptureScreenshotUrl } from './capture-url.js';

describe('capture screenshot protocol URLs', () => {
  it('accepts the renderer contract with an exact capture host', () => {
    expect(
      parseCaptureScreenshotUrl(
        'sitepull-capture://capture/example.com-2026-08-30/pages/home/screenshots/desktop-full.png',
      ),
    ).toEqual({
      captureId: 'example.com-2026-08-30',
      relativePath: 'pages/home/screenshots/desktop-full.png',
    });
  });

  it('decodes each safe segment without decoding path separators', () => {
    expect(
      parseCaptureScreenshotUrl(
        'sitepull-capture://capture/capture-123/pages/pricing/screenshots/mobile%2Dfull.png',
      ),
    ).toEqual({
      captureId: 'capture-123',
      relativePath: 'pages/pricing/screenshots/mobile-full.png',
    });
    expect(
      parseCaptureScreenshotUrl(
        'sitepull-capture://capture/capture-123/pages%2Fpricing/screenshots/mobile.png',
      ),
    ).toBeNull();
  });

  it.each([
    'sitepull-capture://other/capture-123/pages/home/screenshots/desktop.png',
    'sitepull-capture://capture/capture-123/pages/home/rendered.html',
    'sitepull-capture://capture/capture-123/pages/home/screenshots/desktop.svg',
    'sitepull-capture://capture/capture-123/pages/%252e%252e/screenshots/desktop.png',
    'sitepull-capture://capture/capture-123/pages/home/screenshots/desktop.png?raw=1',
    'https://capture/capture-123/pages/home/screenshots/desktop.png',
  ])('rejects untrusted artifact URL %s', (url) => {
    expect(parseCaptureScreenshotUrl(url)).toBeNull();
  });
});
