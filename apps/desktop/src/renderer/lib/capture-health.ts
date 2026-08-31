import type { CaptureManifest } from '@sitepull/contracts';

export interface CaptureHealthSummary {
  readonly status: 'complete' | 'review';
  readonly attemptedPages: number;
  readonly capturedPages: number;
  readonly failedPages: number;
  readonly totalResources: number;
  readonly capturedResources: number;
  readonly unavailableResources: number;
  readonly httpErrorResources: number;
  readonly httpErrorResourceUrls: readonly string[];
  readonly recoveredPages: number;
  readonly failedRoutes: readonly string[];
  readonly truncatedElementPages: number;
  readonly truncatedElementRoutes: readonly string[];
  readonly inaccessibleStylesheetPages: number;
  readonly inaccessibleStylesheets: number;
  readonly inaccessibleStylesheetRoutes: readonly string[];
  readonly unreportedExtractionPages: number;
  readonly unreportedExtractionRoutes: readonly string[];
  readonly boundedUrlDecisions: number;
}

export function captureHealthSummary(manifest: CaptureManifest): CaptureHealthSummary {
  const capturedPages = manifest.pages.filter((page) => page.status === 'captured');
  const failed = manifest.pages.filter((page) => page.status === 'failed');
  const capturedResources = manifest.resources.filter((resource) => resource.captured).length;
  const unavailableResources = manifest.resources.length - capturedResources;
  const httpErrorResources = manifest.resources.filter((resource) => resource.httpStatus >= 400);
  const truncatedElementPages = capturedPages.filter(
    (page) => page.metrics.elementsTruncated === true,
  );
  const inaccessibleStylesheetPages = capturedPages.filter(
    (page) => (page.metrics.inaccessibleStylesheets ?? 0) > 0,
  );
  const inaccessibleStylesheets = inaccessibleStylesheetPages.reduce(
    (total, page) => total + (page.metrics.inaccessibleStylesheets ?? 0),
    0,
  );
  const unreportedExtractionPages = capturedPages.filter(
    (page) =>
      page.metrics.elementsTruncated === undefined ||
      page.metrics.inaccessibleStylesheets === undefined,
  );
  return {
    status:
      failed.length === 0 &&
      unavailableResources === 0 &&
      httpErrorResources.length === 0 &&
      truncatedElementPages.length === 0 &&
      inaccessibleStylesheets === 0 &&
      unreportedExtractionPages.length === 0
        ? 'complete'
        : 'review',
    attemptedPages: manifest.pages.length,
    capturedPages: capturedPages.length,
    failedPages: failed.length,
    totalResources: manifest.resources.length,
    capturedResources,
    unavailableResources,
    httpErrorResources: httpErrorResources.length,
    httpErrorResourceUrls: httpErrorResources.map((resource) => resource.originalUrl),
    recoveredPages: capturedPages.filter(
      (page) => page.attempts?.some((attempt) => attempt.outcome === 'retrying') ?? false,
    ).length,
    failedRoutes: failed.map((page) => page.route),
    truncatedElementPages: truncatedElementPages.length,
    truncatedElementRoutes: truncatedElementPages.map((page) => page.route),
    inaccessibleStylesheetPages: inaccessibleStylesheetPages.length,
    inaccessibleStylesheets,
    inaccessibleStylesheetRoutes: inaccessibleStylesheetPages.map((page) => page.route),
    unreportedExtractionPages: unreportedExtractionPages.length,
    unreportedExtractionRoutes: unreportedExtractionPages.map((page) => page.route),
    boundedUrlDecisions: manifest.skippedUrls.length,
  };
}
