import { z } from 'zod';

import { JsonValueSchema } from './primitives.js';

export const SitepullErrorCodeSchema = z.enum([
  'INVALID_URL',
  'UNSUPPORTED_PROTOCOL',
  'URL_OUTSIDE_ORIGIN',
  'QUERY_VARIANT_LIMIT',
  'DNS_FAILED',
  'PRIVATE_NETWORK_BLOCKED',
  'TLS_FAILED',
  'NAVIGATION_TIMEOUT',
  'HTTP_FORBIDDEN',
  'NO_HTML_DOCUMENT',
  'OUTPUT_NOT_WRITABLE',
  'PATH_TRAVERSAL',
  'RESOURCE_TOO_LARGE',
  'BROWSER_NOT_INSTALLED',
  'CAPTURE_CANCELLED',
  'CRAWL_FAILED',
  'EXPORT_FAILED',
  'INTERNAL_ERROR',
]);

export const SitepullErrorStageSchema = z.enum([
  'validation',
  'launching-browser',
  'rendering',
  'discovering-routes',
  'crawling-pages',
  'capturing-assets',
  'extracting-styles',
  'analyzing-design',
  'building-project',
  'generating-ai-context',
  'packaging',
]);

export const SitepullErrorSchema = z
  .object({
    name: z.literal('SitepullError'),
    code: SitepullErrorCodeSchema,
    message: z.string().min(1).max(10_000),
    stage: SitepullErrorStageSchema.optional(),
    retryable: z.boolean(),
    details: z.record(z.string(), JsonValueSchema).optional(),
  })
  .strict();

export const SerializedSitepullErrorSchema = SitepullErrorSchema;

export type SitepullErrorCode = z.infer<typeof SitepullErrorCodeSchema>;
export type SitepullErrorStage = z.infer<typeof SitepullErrorStageSchema>;
export type SitepullError = z.infer<typeof SitepullErrorSchema>;
export type SerializedSitepullError = SitepullError;
