import { DesignManifestSchema, ElementRecordSchema } from '@sitepull/contracts';
import { describe, expect, it } from 'vitest';

import { analyzeSiteDesign, type AnalyzablePage } from './analyze.js';

describe('analyzeSiteDesign', () => {
  it('preserves a valid negative margin in an immediately valid design manifest', () => {
    const element = ElementRecordSchema.parse({
      tag: 'main',
      role: 'main',
      text: 'Reference content',
      id: null,
      classes: ['offset-layout'],
      domPath: 'html > body > main:nth-child(1)',
      bounds: { x: 0, y: 0, width: 1024, height: 640 },
      styles: {
        display: 'block',
        margin: '-21.265625px 0px 0px',
        'margin-top': '-21.265625px',
        padding: '24px',
        'border-radius': '12px',
      },
    });
    const pages: AnalyzablePage[] = [
      {
        route: '/',
        elements: [element],
        cssVariables: {},
        breakpoints: ['(min-width: 768px)'],
      },
    ];

    const design = analyzeSiteDesign(pages);
    const negativeMargin = design.spacing.find((token) => token.value === '-21.265625px');

    expect(negativeMargin).toMatchObject({
      pixels: -21.265625,
      occurrences: 2,
      contexts: ['margin', 'margin-top'],
      routes: ['/'],
    });
    expect(DesignManifestSchema.parse(design)).toEqual(design);
    expect(design.radii).toEqual([
      {
        value: '12px',
        pixels: 12,
        occurrences: 1,
        contexts: ['border-radius'],
        routes: ['/'],
      },
    ]);
  });
});
