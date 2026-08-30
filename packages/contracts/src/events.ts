import { z } from 'zod';

import { SitepullErrorSchema } from './errors.js';
import {
  ByteCountSchema,
  CaptureIdSchema,
  HttpUrlSchema,
  IsoDateTimeSchema,
  JsonValueSchema,
  NonNegativeIntegerSchema,
  PositiveIntegerSchema,
} from './primitives.js';
import { CaptureResultSummarySchema } from './results.js';

export const CAPTURE_STAGES = [
  'normalizing-url',
  'launching-browser',
  'rendering',
  'discovering-routes',
  'crawling-pages',
  'capturing-assets',
  'extracting-styles',
  'analyzing-design-system',
  'building-ai-pack',
  'packaging',
] as const;

export const CaptureStageSchema = z.enum(CAPTURE_STAGES);
export const CaptureStageStateSchema = z.enum(['started', 'progress', 'completed']);
export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);

export const ProgressCountersSchema = z
  .object({
    discoveredPages: NonNegativeIntegerSchema,
    completedPages: NonNegativeIntegerSchema,
    assets: NonNegativeIntegerSchema,
    elements: NonNegativeIntegerSchema,
    bytesCaptured: ByteCountSchema,
  })
  .strict()
  .superRefine((counters, context) => {
    if (counters.completedPages > counters.discoveredPages) {
      context.addIssue({
        code: 'custom',
        message: 'completedPages cannot exceed discoveredPages',
        path: ['completedPages'],
      });
    }
  });

export const DeterminateProgressSchema = z
  .object({
    completed: NonNegativeIntegerSchema,
    total: PositiveIntegerSchema,
  })
  .strict()
  .refine((progress) => progress.completed <= progress.total, {
    message: 'completed cannot exceed total',
    path: ['completed'],
  });

const EventBaseShape = {
  captureId: CaptureIdSchema,
  sequence: NonNegativeIntegerSchema,
  timestamp: IsoDateTimeSchema,
};

export const ProgressEventSchema = z
  .object({
    type: z.literal('progress'),
    ...EventBaseShape,
    stage: CaptureStageSchema,
    state: CaptureStageStateSchema,
    message: z.string().min(1).max(10_000),
    currentUrl: HttpUrlSchema.nullable(),
    elapsedMs: NonNegativeIntegerSchema,
    counters: ProgressCountersSchema,
    determinate: DeterminateProgressSchema.nullable(),
  })
  .strict();

export const LogEventSchema = z
  .object({
    type: z.literal('log'),
    ...EventBaseShape,
    level: LogLevelSchema,
    stage: CaptureStageSchema.nullable(),
    message: z.string().min(1).max(10_000),
    context: z.record(z.string(), JsonValueSchema).optional(),
  })
  .strict();

export const CaptureCompleteEventSchema = z
  .object({
    type: z.literal('complete'),
    ...EventBaseShape,
    result: CaptureResultSummarySchema,
  })
  .strict()
  .refine((event) => event.captureId === event.result.captureId, {
    message: 'Event and result capture identifiers must match',
    path: ['result', 'captureId'],
  });

export const CaptureErrorEventSchema = z
  .object({
    type: z.literal('error'),
    ...EventBaseShape,
    error: SitepullErrorSchema,
  })
  .strict();

export const CaptureEventSchema = z.discriminatedUnion('type', [
  ProgressEventSchema,
  LogEventSchema,
  CaptureCompleteEventSchema,
  CaptureErrorEventSchema,
]);

export type CaptureStage = z.infer<typeof CaptureStageSchema>;
export type CaptureStageState = z.infer<typeof CaptureStageStateSchema>;
export type LogLevel = z.infer<typeof LogLevelSchema>;
export type ProgressCounters = z.infer<typeof ProgressCountersSchema>;
export type DeterminateProgress = z.infer<typeof DeterminateProgressSchema>;
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;
export type LogEvent = z.infer<typeof LogEventSchema>;
export type CaptureCompleteEvent = z.infer<typeof CaptureCompleteEventSchema>;
export type CaptureErrorEvent = z.infer<typeof CaptureErrorEventSchema>;
export type CaptureEvent = z.infer<typeof CaptureEventSchema>;
