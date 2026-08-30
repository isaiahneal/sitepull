import { z } from 'zod';

import { CrawlConfigSchema } from './config.js';
import { DesignFileManifestSchema, DesignManifestSchema } from './design.js';
import { SitepullErrorSchema } from './errors.js';
import { PageManifestSchema, SkippedUrlSchema } from './pages.js';
import {
  CaptureIdSchema,
  HostnameSchema,
  HttpUrlSchema,
  IsoDateTimeSchema,
  SafeRelativePathSchema,
} from './primitives.js';
import { ResourceManifestEntrySchema } from './resources.js';
import { CaptureResultSummarySchema, CaptureStatusSchema } from './results.js';

export const CaptureSourceSchema = z
  .object({
    inputUrl: HttpUrlSchema,
    normalizedUrl: HttpUrlSchema,
    origin: HttpUrlSchema,
    hostname: HostnameSchema,
  })
  .strict();

export const CaptureArtifactPathsSchema = z
  .object({
    readme: SafeRelativePathSchema,
    aiContext: SafeRelativePathSchema,
    sitepullMetadata: SafeRelativePathSchema,
    manifest: SafeRelativePathSchema,
    pagesDirectory: SafeRelativePathSchema,
    designDirectory: SafeRelativePathSchema,
    assetsDirectory: SafeRelativePathSchema,
    rawDirectory: SafeRelativePathSchema,
    logsDirectory: SafeRelativePathSchema,
  })
  .strict();

export const SitepullMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    generator: z
      .object({
        name: z.literal('Sitepull'),
        version: z.string().min(1).max(128),
      })
      .strict(),
    captureId: CaptureIdSchema,
    source: CaptureSourceSchema,
    capturedAt: IsoDateTimeSchema,
    config: CrawlConfigSchema,
  })
  .strict();

export const CaptureManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatorVersion: z.string().min(1).max(128),
    captureId: CaptureIdSchema,
    status: CaptureStatusSchema,
    source: CaptureSourceSchema,
    startedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.nullable(),
    config: CrawlConfigSchema,
    pages: z.array(PageManifestSchema),
    resources: z.array(ResourceManifestEntrySchema),
    skippedUrls: z.array(SkippedUrlSchema),
    design: DesignManifestSchema,
    designFiles: DesignFileManifestSchema,
    artifacts: CaptureArtifactPathsSchema,
    summary: CaptureResultSummarySchema,
    errors: z.array(SitepullErrorSchema),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (manifest.captureId !== manifest.summary.captureId) {
      context.addIssue({
        code: 'custom',
        message: 'summary.captureId must match captureId',
        path: ['summary', 'captureId'],
      });
    }
    if (manifest.status !== manifest.summary.status) {
      context.addIssue({
        code: 'custom',
        message: 'summary.status must match status',
        path: ['summary', 'status'],
      });
    }
    if (manifest.source.normalizedUrl !== manifest.summary.normalizedUrl) {
      context.addIssue({
        code: 'custom',
        message: 'summary.normalizedUrl must match source.normalizedUrl',
        path: ['summary', 'normalizedUrl'],
      });
    }
  });

export type CaptureSource = z.infer<typeof CaptureSourceSchema>;
export type CaptureArtifactPaths = z.infer<typeof CaptureArtifactPathsSchema>;
export type SitepullMetadata = z.infer<typeof SitepullMetadataSchema>;
export type CaptureManifest = z.infer<typeof CaptureManifestSchema>;
