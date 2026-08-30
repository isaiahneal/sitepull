import { z } from 'zod';

import { ViewportSchema } from './config.js';
import { SitepullErrorSchema } from './errors.js';
import {
  ByteCountSchema,
  HttpUrlSchema,
  IsoDateTimeSchema,
  NonNegativeIntegerSchema,
  RoutePathSchema,
  SafeRelativePathSchema,
} from './primitives.js';

export const LinkDispositionSchema = z.enum(['enqueued', 'visited', 'skipped', 'external']);

export const SkippedUrlReasonSchema = z.enum([
  'invalid-url',
  'unsupported-protocol',
  'fragment-only',
  'external-origin',
  'subdomain-excluded',
  'download',
  'duplicate',
  'tracking-only-duplicate',
  'query-variant-limit',
  'depth-limit',
  'page-limit',
  'non-html',
  'navigation-failed',
]);

export const PageLinkSchema = z
  .object({
    href: z.string().max(8_192),
    text: z.string().max(50_000).nullable(),
    resolvedUrl: HttpUrlSchema.nullable(),
    canonicalUrl: HttpUrlSchema.nullable(),
    disposition: LinkDispositionSchema,
    skipReason: SkippedUrlReasonSchema.optional(),
  })
  .strict()
  .superRefine((link, context) => {
    if (link.disposition === 'skipped' && link.skipReason === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Skipped links require a skipReason',
        path: ['skipReason'],
      });
    }
  });

export const SkippedUrlSchema = z
  .object({
    url: z.string().min(1).max(8_192),
    discoveredOn: HttpUrlSchema.nullable(),
    reason: SkippedUrlReasonSchema,
    detail: z.string().max(10_000).optional(),
  })
  .strict();

export const LinksManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageUrl: HttpUrlSchema,
    links: z.array(PageLinkSchema),
    skipped: z.array(SkippedUrlSchema),
  })
  .strict();

export const DocumentMetaSchema = z
  .object({
    name: z.string().max(1_024).optional(),
    property: z.string().max(1_024).optional(),
    httpEquiv: z.string().max(1_024).optional(),
    content: z.string().max(100_000),
  })
  .strict();

export const DocumentManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    url: HttpUrlSchema,
    canonicalUrl: HttpUrlSchema,
    route: RoutePathSchema,
    title: z.string().max(10_000),
    language: z.string().max(128).nullable(),
    doctype: z.string().max(1_024).nullable(),
    contentType: z.string().max(1_024),
    capturedAt: IsoDateTimeSchema,
    viewport: ViewportSchema,
    scrollWidth: NonNegativeIntegerSchema,
    scrollHeight: NonNegativeIntegerSchema,
    meta: z.array(DocumentMetaSchema),
  })
  .strict();

export const ScreenshotManifestSchema = z
  .object({
    viewport: ViewportSchema,
    viewportPath: SafeRelativePathSchema,
    fullPagePath: SafeRelativePathSchema,
    viewportByteSize: ByteCountSchema.optional(),
    fullPageByteSize: ByteCountSchema.optional(),
  })
  .strict();

export const PageFileManifestSchema = z
  .object({
    renderedHtml: SafeRelativePathSchema,
    document: SafeRelativePathSchema,
    elements: SafeRelativePathSchema,
    links: SafeRelativePathSchema,
    network: SafeRelativePathSchema,
  })
  .strict();

export const PageCaptureStatusSchema = z.enum(['captured', 'failed', 'cancelled']);

export const PageMetricsSchema = z
  .object({
    visibleElements: NonNegativeIntegerSchema,
    discoveredLinks: NonNegativeIntegerSchema,
    networkRequests: NonNegativeIntegerSchema,
    capturedResources: NonNegativeIntegerSchema,
    byteSize: ByteCountSchema,
    durationMs: NonNegativeIntegerSchema,
  })
  .strict();

export const PageManifestSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u),
    route: RoutePathSchema,
    url: HttpUrlSchema,
    canonicalUrl: HttpUrlSchema,
    title: z.string().max(10_000),
    contentType: z.string().max(1_024).nullable(),
    httpStatus: z.number().int().min(0).max(599).nullable(),
    depth: z.number().int().nonnegative(),
    status: PageCaptureStatusSchema,
    capturedAt: IsoDateTimeSchema,
    files: PageFileManifestSchema.nullable(),
    screenshots: z.array(ScreenshotManifestSchema),
    metrics: PageMetricsSchema,
    errors: z.array(SitepullErrorSchema),
  })
  .strict()
  .superRefine((page, context) => {
    if (page.status === 'captured' && page.files === null) {
      context.addIssue({
        code: 'custom',
        message: 'Captured pages require file paths',
        path: ['files'],
      });
    }
    if (page.status === 'failed' && page.errors.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Failed pages require at least one structured error',
        path: ['errors'],
      });
    }

    const viewportNames = new Set<string>();
    for (const [index, screenshot] of page.screenshots.entries()) {
      if (viewportNames.has(screenshot.viewport.name)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate screenshot viewport: ${screenshot.viewport.name}`,
          path: ['screenshots', index, 'viewport', 'name'],
        });
      }
      viewportNames.add(screenshot.viewport.name);
    }
  });

export type LinkDisposition = z.infer<typeof LinkDispositionSchema>;
export type SkippedUrlReason = z.infer<typeof SkippedUrlReasonSchema>;
export type PageLink = z.infer<typeof PageLinkSchema>;
export type SkippedUrl = z.infer<typeof SkippedUrlSchema>;
export type LinksManifest = z.infer<typeof LinksManifestSchema>;
export type DocumentMeta = z.infer<typeof DocumentMetaSchema>;
export type DocumentManifest = z.infer<typeof DocumentManifestSchema>;
export type ScreenshotManifest = z.infer<typeof ScreenshotManifestSchema>;
export type PageFileManifest = z.infer<typeof PageFileManifestSchema>;
export type PageCaptureStatus = z.infer<typeof PageCaptureStatusSchema>;
export type PageMetrics = z.infer<typeof PageMetricsSchema>;
export type PageManifest = z.infer<typeof PageManifestSchema>;
