import { z } from 'zod';

import { HttpUrlSchema, IsoDateTimeSchema, NonNegativeIntegerSchema } from './primitives.js';

const CssValueSchema = z.string().max(4_096);

/**
 * Deliberately bounded computed-style subset. This keeps element captures useful
 * for reconstruction without serializing every browser CSS property.
 */
export const ComputedStyleSchema = z
  .object({
    display: CssValueSchema.optional(),
    position: CssValueSchema.optional(),
    top: CssValueSchema.optional(),
    right: CssValueSchema.optional(),
    bottom: CssValueSchema.optional(),
    left: CssValueSchema.optional(),
    width: CssValueSchema.optional(),
    height: CssValueSchema.optional(),
    'max-width': CssValueSchema.optional(),
    'max-height': CssValueSchema.optional(),
    'min-width': CssValueSchema.optional(),
    'min-height': CssValueSchema.optional(),
    margin: CssValueSchema.optional(),
    'margin-top': CssValueSchema.optional(),
    'margin-right': CssValueSchema.optional(),
    'margin-bottom': CssValueSchema.optional(),
    'margin-left': CssValueSchema.optional(),
    padding: CssValueSchema.optional(),
    'padding-top': CssValueSchema.optional(),
    'padding-right': CssValueSchema.optional(),
    'padding-bottom': CssValueSchema.optional(),
    'padding-left': CssValueSchema.optional(),
    gap: CssValueSchema.optional(),
    'row-gap': CssValueSchema.optional(),
    'column-gap': CssValueSchema.optional(),
    flex: CssValueSchema.optional(),
    'flex-basis': CssValueSchema.optional(),
    'flex-direction': CssValueSchema.optional(),
    'flex-flow': CssValueSchema.optional(),
    'flex-grow': CssValueSchema.optional(),
    'flex-shrink': CssValueSchema.optional(),
    'flex-wrap': CssValueSchema.optional(),
    grid: CssValueSchema.optional(),
    'grid-auto-columns': CssValueSchema.optional(),
    'grid-auto-flow': CssValueSchema.optional(),
    'grid-auto-rows': CssValueSchema.optional(),
    'grid-column': CssValueSchema.optional(),
    'grid-row': CssValueSchema.optional(),
    'grid-template-areas': CssValueSchema.optional(),
    'grid-template-columns': CssValueSchema.optional(),
    'grid-template-rows': CssValueSchema.optional(),
    'align-content': CssValueSchema.optional(),
    'align-items': CssValueSchema.optional(),
    'align-self': CssValueSchema.optional(),
    'justify-content': CssValueSchema.optional(),
    'justify-items': CssValueSchema.optional(),
    'justify-self': CssValueSchema.optional(),
    'font-family': CssValueSchema.optional(),
    'font-size': CssValueSchema.optional(),
    'font-style': CssValueSchema.optional(),
    'font-weight': CssValueSchema.optional(),
    'line-height': CssValueSchema.optional(),
    'letter-spacing': CssValueSchema.optional(),
    'text-align': CssValueSchema.optional(),
    'text-decoration': CssValueSchema.optional(),
    'text-transform': CssValueSchema.optional(),
    color: CssValueSchema.optional(),
    background: CssValueSchema.optional(),
    'background-color': CssValueSchema.optional(),
    'background-image': CssValueSchema.optional(),
    border: CssValueSchema.optional(),
    'border-width': CssValueSchema.optional(),
    'border-style': CssValueSchema.optional(),
    'border-color': CssValueSchema.optional(),
    'border-radius': CssValueSchema.optional(),
    'box-shadow': CssValueSchema.optional(),
    opacity: CssValueSchema.optional(),
    overflow: CssValueSchema.optional(),
    'overflow-x': CssValueSchema.optional(),
    'overflow-y': CssValueSchema.optional(),
    transform: CssValueSchema.optional(),
    transition: CssValueSchema.optional(),
    animation: CssValueSchema.optional(),
    'backdrop-filter': CssValueSchema.optional(),
    visibility: CssValueSchema.optional(),
    'object-fit': CssValueSchema.optional(),
  })
  .strict();

export const ElementBoundsSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
  })
  .strict();

export const PseudoElementStyleSchema = z
  .object({
    content: z.string().max(50_000).nullable(),
    styles: ComputedStyleSchema,
  })
  .strict();

export const ElementRecordSchema = z
  .object({
    tag: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-zA-Z][a-zA-Z0-9-]*$/u),
    role: z.string().min(1).max(128).nullable(),
    text: z.string().max(100_000).nullable(),
    id: z.string().max(4_096).nullable(),
    classes: z.array(z.string().max(4_096)).max(1_000),
    domPath: z.string().min(1).max(32_768),
    bounds: ElementBoundsSchema,
    styles: ComputedStyleSchema,
    pseudoElements: z
      .object({
        before: PseudoElementStyleSchema.optional(),
        after: PseudoElementStyleSchema.optional(),
      })
      .strict()
      .optional(),
    attributes: z.record(z.string().max(256), z.string().max(100_000)).optional(),
  })
  .strict();

export const ElementsManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageUrl: HttpUrlSchema,
    capturedAt: IsoDateTimeSchema,
    elementCount: NonNegativeIntegerSchema,
    truncated: z.boolean(),
    maxElements: z.number().int().positive(),
    elements: z.array(ElementRecordSchema),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (manifest.elementCount !== manifest.elements.length) {
      context.addIssue({
        code: 'custom',
        message: 'elementCount must equal elements.length',
        path: ['elementCount'],
      });
    }
    if (manifest.elements.length > manifest.maxElements) {
      context.addIssue({
        code: 'custom',
        message: 'elements cannot exceed maxElements',
        path: ['elements'],
      });
    }
  });

export type ComputedStyle = z.infer<typeof ComputedStyleSchema>;
export type ElementBounds = z.infer<typeof ElementBoundsSchema>;
export type PseudoElementStyle = z.infer<typeof PseudoElementStyleSchema>;
export type ElementRecord = z.infer<typeof ElementRecordSchema>;
export type ElementsManifest = z.infer<typeof ElementsManifestSchema>;
