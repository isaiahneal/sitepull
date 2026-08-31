import { z } from 'zod';

import { ComputedStyleSchema } from './elements.js';
import {
  ConfidenceSchema,
  IsoDateTimeSchema,
  NonNegativeIntegerSchema,
  PositiveIntegerSchema,
  RoutePathSchema,
  SafeRelativePathSchema,
} from './primitives.js';

const TokenValueSchema = z.string().min(1).max(8_192);

export const ColorRoleSchema = z.enum([
  'page-background',
  'surface',
  'elevated-surface',
  'primary-text',
  'secondary-text',
  'muted-text',
  'border',
  'accent',
]);

export const ColorTokenSchema = z
  .object({
    normalizedValue: TokenValueSchema,
    rawValues: z.array(TokenValueSchema).min(1),
    occurrences: PositiveIntegerSchema,
    routes: z.array(RoutePathSchema),
    inferredRole: ColorRoleSchema.nullable(),
    confidence: ConfidenceSchema.nullable(),
  })
  .strict()
  .superRefine((token, context) => {
    if ((token.inferredRole === null) !== (token.confidence === null)) {
      context.addIssue({
        code: 'custom',
        message: 'An inferred color role and confidence must be provided together',
        path: ['confidence'],
      });
    }
  });

export const TypographyRoleSchema = z.enum([
  'display',
  'h1',
  'h2',
  'h3',
  'body',
  'small',
  'caption',
]);

export const TypographyTokenSchema = z
  .object({
    fontFamily: TokenValueSchema,
    fontSize: TokenValueSchema,
    fontWeight: TokenValueSchema,
    lineHeight: TokenValueSchema,
    letterSpacing: TokenValueSchema,
    occurrences: PositiveIntegerSchema,
    routes: z.array(RoutePathSchema),
    inferredRole: TypographyRoleSchema.nullable(),
    confidence: ConfidenceSchema.nullable(),
  })
  .strict()
  .superRefine((token, context) => {
    if ((token.inferredRole === null) !== (token.confidence === null)) {
      context.addIssue({
        code: 'custom',
        message: 'An inferred typography role and confidence must be provided together',
        path: ['confidence'],
      });
    }
  });

const MeasurementTokenShape = {
  value: TokenValueSchema,
  occurrences: PositiveIntegerSchema,
  contexts: z.array(z.string().min(1).max(128)),
  routes: z.array(RoutePathSchema),
} as const;

function hasNegativeCssLength(value: string): boolean {
  const match = /^\s*(-?(?:\d+(?:\.\d*)?|\.\d+))(?:[a-z]+|%)\s*$/iu.exec(value);
  return match?.[1] !== undefined && Number(match[1]) < 0;
}

/** Measurements whose CSS domains cannot be negative, such as border radii. */
export const MeasurementTokenSchema = z
  .object({
    ...MeasurementTokenShape,
    pixels: z.number().finite().nonnegative().nullable(),
  })
  .strict()
  .superRefine((token, context) => {
    if ((token.pixels !== null && token.pixels < 0) || hasNegativeCssLength(token.value)) {
      context.addIssue({
        code: 'custom',
        message: 'This measurement domain cannot contain negative CSS lengths',
        path: [token.pixels !== null && token.pixels < 0 ? 'pixels' : 'value'],
      });
    }
  });

/**
 * Spacing includes margins, whose computed values may legitimately be signed.
 * Negative values remain invalid for padding and gap contexts.
 */
export const SpacingTokenSchema = z
  .object({
    ...MeasurementTokenShape,
    pixels: z.number().finite().nullable(),
  })
  .strict()
  .superRefine((token, context) => {
    const negative =
      (token.pixels !== null && token.pixels < 0) || hasNegativeCssLength(token.value);
    if (
      negative &&
      (token.contexts.length === 0 ||
        token.contexts.some((property) => property !== 'margin' && !property.startsWith('margin-')))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Negative spacing measurements are valid only for margin contexts',
        path: [token.pixels !== null && token.pixels < 0 ? 'pixels' : 'value'],
      });
    }
  });

export const ShadowTokenSchema = z
  .object({
    value: TokenValueSchema,
    occurrences: PositiveIntegerSchema,
    routes: z.array(RoutePathSchema),
  })
  .strict();

export const BorderTokenSchema = z
  .object({
    value: TokenValueSchema,
    occurrences: PositiveIntegerSchema,
    routes: z.array(RoutePathSchema),
  })
  .strict();

export const BreakpointTokenSchema = z
  .object({
    mediaQuery: TokenValueSchema,
    minWidthPx: z.number().finite().nonnegative().nullable(),
    maxWidthPx: z.number().finite().nonnegative().nullable(),
    occurrences: PositiveIntegerSchema,
  })
  .strict()
  .superRefine((breakpoint, context) => {
    if (
      breakpoint.minWidthPx !== null &&
      breakpoint.maxWidthPx !== null &&
      breakpoint.minWidthPx > breakpoint.maxWidthPx
    ) {
      context.addIssue({
        code: 'custom',
        message: 'minWidthPx cannot exceed maxWidthPx',
        path: ['minWidthPx'],
      });
    }
  });

export const CssVariableTokenSchema = z
  .object({
    name: z
      .string()
      .min(3)
      .max(1_024)
      .regex(/^--[^\s:;]+$/u),
    values: z.array(TokenValueSchema).min(1),
    occurrences: PositiveIntegerSchema,
    routes: z.array(RoutePathSchema),
  })
  .strict();

export const ComponentExampleSchema = z
  .object({
    route: RoutePathSchema,
    domPath: z.string().min(1).max(32_768),
    elementIndex: NonNegativeIntegerSchema.optional(),
    screenshotPath: SafeRelativePathSchema.optional(),
  })
  .strict();

export const ComponentCandidateSchema = z
  .object({
    suggestedName: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z][A-Za-z0-9]*$/u, 'Expected a component-like name'),
    nameIsInferred: z.literal(true),
    confidence: ConfidenceSchema,
    occurrences: PositiveIntegerSchema,
    routes: z.array(RoutePathSchema).min(1),
    signature: z.string().min(1).max(100_000),
    styleSummary: ComputedStyleSchema,
    examples: z.array(ComponentExampleSchema).max(100),
  })
  .strict();

export const ComponentManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: IsoDateTimeSchema,
    candidates: z.array(ComponentCandidateSchema),
  })
  .strict();

export const DesignManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: IsoDateTimeSchema,
    sourcePageCount: NonNegativeIntegerSchema,
    colors: z.array(ColorTokenSchema),
    typography: z.array(TypographyTokenSchema),
    spacing: z.array(SpacingTokenSchema),
    radii: z.array(MeasurementTokenSchema),
    shadows: z.array(ShadowTokenSchema),
    borders: z.array(BorderTokenSchema),
    breakpoints: z.array(BreakpointTokenSchema),
    cssVariables: z.array(CssVariableTokenSchema),
    components: z.array(ComponentCandidateSchema),
  })
  .strict();

export const DesignFileManifestSchema = z
  .object({
    designSystemMarkdown: SafeRelativePathSchema,
    colors: SafeRelativePathSchema,
    typography: SafeRelativePathSchema,
    spacing: SafeRelativePathSchema,
    radii: SafeRelativePathSchema,
    shadows: SafeRelativePathSchema,
    breakpoints: SafeRelativePathSchema,
    cssVariables: SafeRelativePathSchema,
    components: SafeRelativePathSchema,
  })
  .strict();

export type ColorRole = z.infer<typeof ColorRoleSchema>;
export type ColorToken = z.infer<typeof ColorTokenSchema>;
export type TypographyRole = z.infer<typeof TypographyRoleSchema>;
export type TypographyToken = z.infer<typeof TypographyTokenSchema>;
export type MeasurementToken = z.infer<typeof MeasurementTokenSchema>;
export type SpacingToken = z.infer<typeof SpacingTokenSchema>;
export type ShadowToken = z.infer<typeof ShadowTokenSchema>;
export type BorderToken = z.infer<typeof BorderTokenSchema>;
export type BreakpointToken = z.infer<typeof BreakpointTokenSchema>;
export type CssVariableToken = z.infer<typeof CssVariableTokenSchema>;
export type ComponentExample = z.infer<typeof ComponentExampleSchema>;
export type ComponentCandidate = z.infer<typeof ComponentCandidateSchema>;
export type ComponentManifest = z.infer<typeof ComponentManifestSchema>;
export type DesignManifest = z.infer<typeof DesignManifestSchema>;
export type DesignFileManifest = z.infer<typeof DesignFileManifestSchema>;
