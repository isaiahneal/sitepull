import { z } from 'zod';

import {
  ByteCountSchema,
  HttpUrlSchema,
  IsoDateTimeSchema,
  NonNegativeIntegerSchema,
  SafeRelativePathSchema,
  Sha256Schema,
} from './primitives.js';

export const ResourceKindSchema = z.enum([
  'html',
  'css',
  'javascript',
  'image',
  'svg',
  'font',
  'json',
  'manifest',
  'icon',
  'source-map',
  'other',
]);

export const ResourceManifestEntrySchema = z
  .object({
    originalUrl: HttpUrlSchema,
    finalUrl: HttpUrlSchema.optional(),
    kind: ResourceKindSchema,
    contentType: z.string().max(1_024).nullable(),
    httpStatus: z.number().int().min(0).max(599),
    localPath: SafeRelativePathSchema.nullable(),
    byteSize: ByteCountSchema,
    sha256: Sha256Schema.nullable(),
    referencedByPages: z.array(HttpUrlSchema),
    captured: z.boolean(),
    failureReason: z.string().min(1).max(10_000).optional(),
  })
  .strict()
  .superRefine((resource, context) => {
    if (resource.captured && (resource.localPath === null || resource.sha256 === null)) {
      context.addIssue({
        code: 'custom',
        message: 'Captured resources require localPath and sha256',
        path: ['captured'],
      });
    }
    if (!resource.captured && resource.failureReason === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Uncaptured resources require failureReason',
        path: ['failureReason'],
      });
    }
  });

export const AssetManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: IsoDateTimeSchema,
    resources: z.array(ResourceManifestEntrySchema),
    totalResources: NonNegativeIntegerSchema,
    capturedResources: NonNegativeIntegerSchema,
    uniqueAssets: NonNegativeIntegerSchema,
    totalBytes: ByteCountSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    if (manifest.totalResources !== manifest.resources.length) {
      context.addIssue({
        code: 'custom',
        message: 'totalResources must equal resources.length',
        path: ['totalResources'],
      });
    }
    const captured = manifest.resources.filter((resource) => resource.captured).length;
    if (manifest.capturedResources !== captured) {
      context.addIssue({
        code: 'custom',
        message: 'capturedResources must match captured entries',
        path: ['capturedResources'],
      });
    }
    if (manifest.uniqueAssets > manifest.capturedResources) {
      context.addIssue({
        code: 'custom',
        message: 'uniqueAssets cannot exceed capturedResources',
        path: ['uniqueAssets'],
      });
    }
  });

export const NetworkEntrySchema = z
  .object({
    url: HttpUrlSchema,
    method: z.string().min(1).max(32),
    kind: ResourceKindSchema,
    status: z.number().int().min(0).max(599).nullable(),
    contentType: z.string().max(1_024).nullable(),
    byteSize: ByteCountSchema.nullable(),
    startedAt: IsoDateTimeSchema,
    durationMs: z.number().finite().nonnegative().nullable(),
    requestHeaders: z.record(z.string().max(256), z.string().max(100_000)).optional(),
    responseHeaders: z.record(z.string().max(256), z.string().max(100_000)).optional(),
    fromCache: z.boolean().optional(),
    redirectedFrom: HttpUrlSchema.nullable().optional(),
    failed: z.boolean(),
    failureText: z.string().max(10_000).nullable(),
  })
  .strict();

export const NetworkManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageUrl: HttpUrlSchema,
    entries: z.array(NetworkEntrySchema),
  })
  .strict();

export type ResourceKind = z.infer<typeof ResourceKindSchema>;
export type ResourceManifestEntry = z.infer<typeof ResourceManifestEntrySchema>;
export type AssetManifest = z.infer<typeof AssetManifestSchema>;
export type NetworkEntry = z.infer<typeof NetworkEntrySchema>;
export type NetworkManifest = z.infer<typeof NetworkManifestSchema>;
