import { z } from 'zod';

import { SitepullErrorSchema } from './errors.js';
import {
  ByteCountSchema,
  CaptureIdSchema,
  FileSystemPathSchema,
  HostnameSchema,
  HttpUrlSchema,
  IsoDateTimeSchema,
  NonNegativeIntegerSchema,
} from './primitives.js';

export const CaptureStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export const CaptureCountsSchema = z
  .object({
    pages: NonNegativeIntegerSchema,
    assets: NonNegativeIntegerSchema,
    components: NonNegativeIntegerSchema,
    elements: NonNegativeIntegerSchema,
    bytes: ByteCountSchema,
  })
  .strict();

export const PackageSummarySchema = z
  .object({
    estimatedBytes: ByteCountSchema,
    archivePath: FileSystemPathSchema.nullable(),
    compressedBytes: ByteCountSchema.nullable(),
  })
  .strict();

export const CaptureResultSummarySchema = z
  .object({
    captureId: CaptureIdSchema,
    status: CaptureStatusSchema,
    sourceUrl: HttpUrlSchema,
    normalizedUrl: HttpUrlSchema,
    hostname: HostnameSchema,
    outputDirectory: FileSystemPathSchema,
    startedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.nullable(),
    durationMs: NonNegativeIntegerSchema,
    counts: CaptureCountsSchema,
    aiPack: PackageSummarySchema.nullable(),
    fullCapture: PackageSummarySchema.nullable(),
    error: SitepullErrorSchema.nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    const terminal = ['completed', 'failed', 'cancelled'].includes(result.status);
    if (terminal !== (result.completedAt !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Terminal captures require completedAt; active captures must omit it',
        path: ['completedAt'],
      });
    }
    if (result.status === 'failed' && result.error === null) {
      context.addIssue({
        code: 'custom',
        message: 'Failed captures require a structured error',
        path: ['error'],
      });
    }
  });

export type CaptureStatus = z.infer<typeof CaptureStatusSchema>;
export type CaptureCounts = z.infer<typeof CaptureCountsSchema>;
export type PackageSummary = z.infer<typeof PackageSummarySchema>;
export type CaptureResultSummary = z.infer<typeof CaptureResultSummarySchema>;
