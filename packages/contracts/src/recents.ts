import { z } from 'zod';

import { CrawlConfigSchema } from './config.js';
import {
  ByteCountSchema,
  CaptureIdSchema,
  FileSystemPathSchema,
  HostnameSchema,
  HttpUrlSchema,
  IsoDateTimeSchema,
  NonNegativeIntegerSchema,
} from './primitives.js';
import { CaptureStatusSchema } from './results.js';
import { ProxyPoolRecipeSchema } from './proxy.js';

export const CaptureAvailabilitySchema = z.enum(['available', 'missing']);

/**
 * The complete, effective desktop request needed to reproduce a capture.
 * `outputDirectory` is the authorized parent rather than the finalized capture
 * directory so a repeat capture always receives a fresh timestamped child.
 */
export const CaptureRecipeSchema = z
  .object({
    url: HttpUrlSchema,
    allowHttpFallback: z.boolean(),
    outputDirectory: FileSystemPathSchema,
    config: CrawlConfigSchema,
    proxyPool: ProxyPoolRecipeSchema.nullable().default(null),
  })
  .strict();

export const RecentCaptureSchema = z
  .object({
    captureId: CaptureIdSchema,
    url: HttpUrlSchema,
    hostname: HostnameSchema,
    capturedAt: IsoDateTimeSchema,
    outputPath: FileSystemPathSchema,
    pageCount: NonNegativeIntegerSchema,
    assetCount: NonNegativeIntegerSchema,
    byteSize: ByteCountSchema,
    status: CaptureStatusSchema,
    availability: CaptureAvailabilitySchema,
    recipe: CaptureRecipeSchema.nullable().default(null),
  })
  .strict();

export const RecentsIndexSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    updatedAt: IsoDateTimeSchema,
    lastUsedRecipe: CaptureRecipeSchema.nullable().default(null),
    captures: z.array(RecentCaptureSchema).max(100),
  })
  .strict()
  .superRefine((index, context) => {
    const ids = new Set<string>();
    for (const [captureIndex, capture] of index.captures.entries()) {
      if (ids.has(capture.captureId)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate captureId: ${capture.captureId}`,
          path: ['captures', captureIndex, 'captureId'],
        });
      }
      ids.add(capture.captureId);
    }
  });

export type CaptureAvailability = z.infer<typeof CaptureAvailabilitySchema>;
export type CaptureRecipe = z.infer<typeof CaptureRecipeSchema>;
export type RecentCapture = z.infer<typeof RecentCaptureSchema>;
export type RecentsIndex = z.infer<typeof RecentsIndexSchema>;
