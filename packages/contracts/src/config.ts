import { z } from 'zod';

import { FileSystemPathSchema, HttpUrlSchema } from './primitives.js';

export const BrowserEngineSchema = z.enum(['webkit', 'chromium', 'firefox']);

export const ViewportNameSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9][a-z0-9-]*$/u, 'Use a lowercase viewport identifier');

export const ViewportSchema = z
  .object({
    name: ViewportNameSchema,
    width: z.number().int().min(240).max(7_680),
    height: z.number().int().min(240).max(4_320),
  })
  .strict();

export const VIEWPORT_PRESETS = {
  desktop: { name: 'desktop', width: 1_440, height: 1_000 },
  mobile: { name: 'mobile', width: 390, height: 844 },
  tablet: { name: 'tablet', width: 1_024, height: 768 },
} as const;

export const DEFAULT_VIEWPORTS = [VIEWPORT_PRESETS.desktop, VIEWPORT_PRESETS.mobile] as const;

export const DEFAULT_MAX_RESOURCE_BYTES = 25 * 1024 * 1024;
export const DEFAULT_MAX_CAPTURE_RESOURCE_BYTES = 512 * 1024 * 1024;
export const DEFAULT_RESOURCE_BODY_CONCURRENCY = 3;

function makeDefaultViewports(): Array<z.infer<typeof ViewportSchema>> {
  return DEFAULT_VIEWPORTS.map((viewport) => ({ ...viewport }));
}

export const CrawlConfigSchema = z
  .object({
    engine: BrowserEngineSchema.default('webkit'),
    maxDepth: z.number().int().min(0).max(10).default(2),
    maxPages: z.number().int().min(1).max(500).default(25),
    sameOriginOnly: z.boolean().default(true),
    includeSubdomains: z.boolean().default(false),
    viewports: z.array(ViewportSchema).min(1).max(8).default(makeDefaultViewports),
    pageTimeoutMs: z.number().int().min(1_000).max(300_000).default(30_000),
    crawlConcurrency: z.number().int().min(1).max(8).default(3),
    maxElementsPerPage: z.number().int().min(100).max(100_000).default(10_000),
    maxResourceBytes: z
      .number()
      .int()
      .min(1)
      .max(1024 * 1024 * 1024)
      .default(DEFAULT_MAX_RESOURCE_BYTES),
    maxCaptureResourceBytes: z
      .number()
      .int()
      .min(1)
      .max(16 * 1024 * 1024 * 1024)
      .default(DEFAULT_MAX_CAPTURE_RESOURCE_BYTES),
    resourceBodyConcurrency: z
      .number()
      .int()
      .min(1)
      .max(16)
      .default(DEFAULT_RESOURCE_BODY_CONCURRENCY),
    headed: z.boolean().default(false),
  })
  .strict()
  .superRefine((config, context) => {
    const names = new Set<string>();
    for (const [index, viewport] of config.viewports.entries()) {
      if (names.has(viewport.name)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate viewport name: ${viewport.name}`,
          path: ['viewports', index, 'name'],
        });
      }
      names.add(viewport.name);
    }
  });

export const DEFAULT_CRAWL_CONFIG = CrawlConfigSchema.parse({});

export const CrawlRequestSchema = z
  .object({
    url: HttpUrlSchema,
    outputDirectory: FileSystemPathSchema,
    config: CrawlConfigSchema.default(() => CrawlConfigSchema.parse({})),
  })
  .strict();

export type BrowserEngine = z.infer<typeof BrowserEngineSchema>;
export type ViewportName = z.infer<typeof ViewportNameSchema>;
export type Viewport = z.infer<typeof ViewportSchema>;
export type CrawlConfig = z.infer<typeof CrawlConfigSchema>;
export type CrawlConfigInput = z.input<typeof CrawlConfigSchema>;
export type CrawlRequest = z.infer<typeof CrawlRequestSchema>;
export type CrawlRequestInput = z.input<typeof CrawlRequestSchema>;
