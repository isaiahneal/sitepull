import type { CaptureManifest } from '@sitepull/contracts';
import { describe, expect, it } from 'vitest';

import { captureHealthSummary } from './capture-health.js';

describe('captureHealthSummary', () => {
  it('distinguishes retry recovery from unresolved evidence gaps', () => {
    const manifest = {
      pages: [
        {
          route: '/',
          status: 'captured',
          metrics: {},
          attempts: [{ outcome: 'retrying' }, { outcome: 'captured' }],
        },
        { route: '/pricing', status: 'failed', metrics: {}, attempts: [{ outcome: 'failed' }] },
      ],
      resources: [
        { captured: true, httpStatus: 200, originalUrl: 'https://example.com/app.css' },
        { captured: false, httpStatus: 200, originalUrl: 'https://example.com/hero.png' },
      ],
      skippedUrls: [{ reason: 'external-origin' }],
    } as unknown as CaptureManifest;

    expect(captureHealthSummary(manifest)).toEqual({
      status: 'review',
      attemptedPages: 2,
      capturedPages: 1,
      failedPages: 1,
      totalResources: 2,
      capturedResources: 1,
      unavailableResources: 1,
      httpErrorResources: 0,
      httpErrorResourceUrls: [],
      recoveredPages: 1,
      failedRoutes: ['/pricing'],
      truncatedElementPages: 0,
      truncatedElementRoutes: [],
      inaccessibleStylesheetPages: 0,
      inaccessibleStylesheets: 0,
      inaccessibleStylesheetRoutes: [],
      unreportedExtractionPages: 1,
      unreportedExtractionRoutes: ['/'],
      boundedUrlDecisions: 1,
    });
  });

  it('marks extraction limits as evidence that needs review', () => {
    const manifest = {
      pages: [
        {
          route: '/',
          status: 'captured',
          metrics: { elementsTruncated: true, inaccessibleStylesheets: 2 },
        },
        {
          route: '/about',
          status: 'captured',
          metrics: { elementsTruncated: false, inaccessibleStylesheets: 1 },
        },
      ],
      resources: [{ captured: true }],
      skippedUrls: [],
    } as unknown as CaptureManifest;

    expect(captureHealthSummary(manifest)).toMatchObject({
      status: 'review',
      truncatedElementPages: 1,
      truncatedElementRoutes: ['/'],
      inaccessibleStylesheetPages: 2,
      inaccessibleStylesheets: 3,
      inaccessibleStylesheetRoutes: ['/', '/about'],
    });
  });

  it('keeps a legacy manifest readable without claiming its unreported evidence is complete', () => {
    const manifest = {
      pages: [{ route: '/', status: 'captured', metrics: {} }],
      resources: [],
      skippedUrls: [],
    } as unknown as CaptureManifest;

    expect(captureHealthSummary(manifest)).toMatchObject({
      status: 'review',
      unreportedExtractionPages: 1,
      unreportedExtractionRoutes: ['/'],
    });
  });

  it('treats a saved HTTP error body as a resource evidence gap', () => {
    const manifest = {
      pages: [
        {
          route: '/',
          status: 'captured',
          metrics: { elementsTruncated: false, inaccessibleStylesheets: 0 },
        },
      ],
      resources: [
        {
          captured: true,
          httpStatus: 404,
          originalUrl: 'https://example.com/missing.css',
        },
      ],
      skippedUrls: [],
    } as unknown as CaptureManifest;

    expect(captureHealthSummary(manifest)).toMatchObject({
      status: 'review',
      capturedResources: 1,
      unavailableResources: 0,
      httpErrorResources: 1,
      httpErrorResourceUrls: ['https://example.com/missing.css'],
    });
  });
});
