import { z } from 'zod';

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

export const CaptureAvailabilitySchema = z.enum(['available', 'missing']);

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
  })
  .strict();

export const RecentsIndexSchema = z
  .object({
    schemaVersion: z.literal(1),
    updatedAt: IsoDateTimeSchema,
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
export type RecentCapture = z.infer<typeof RecentCaptureSchema>;
export type RecentsIndex = z.infer<typeof RecentsIndexSchema>;
