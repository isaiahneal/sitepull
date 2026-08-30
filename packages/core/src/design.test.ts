import { describe, expect, it } from 'vitest';

import {
  aggregateColors,
  aggregateDesignTokens,
  normalizeCssColor,
  type ComputedStyleSample,
} from './design.js';

describe('normalizeCssColor', () => {
  it('normalizes equivalent hex, RGB, percentage, HSL, and named forms', () => {
    expect(normalizeCssColor('#fff')).toBe('#ffffff');
    expect(normalizeCssColor('rgb(255, 255, 255)')).toBe('#ffffff');
    expect(normalizeCssColor('rgb(100% 100% 100%)')).toBe('#ffffff');
    expect(normalizeCssColor('hsl(0 0% 100%)')).toBe('#ffffff');
    expect(normalizeCssColor('white')).toBe('#ffffff');
    expect(normalizeCssColor('#ff000080')).toBe('rgba(255, 0, 0, 0.502)');
    expect(normalizeCssColor('rgba(255 0 0 / 50%)')).toBe('rgba(255, 0, 0, 0.5)');
    expect(normalizeCssColor('transparent')).toBe('rgba(0, 0, 0, 0)');
  });

  it('omits context-dependent keywords and preserves advanced color spaces', () => {
    expect(normalizeCssColor('currentColor')).toBeUndefined();
    expect(normalizeCssColor('color(display-p3 1 0.2 0.1)')).toBe('color(display-p3 1 0.2 0.1)');
  });
});

describe('design token aggregation', () => {
  const samples: ComputedStyleSample[] = [
    {
      tag: 'h1',
      styles: {
        color: '#fff',
        backgroundColor: 'rgb(0, 0, 0)',
        fontFamily: 'Inter, sans-serif',
        fontSize: '64px',
        fontWeight: '700',
        lineHeight: '1.06',
        letterSpacing: '-1px',
        padding: '16px 24px',
        borderRadius: '12px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
      },
    },
    {
      tag: 'h2',
      styles: {
        color: 'rgb(255 255 255)',
        backgroundColor: '#000000',
        fontFamily: 'Inter, sans-serif',
        fontSize: '64px',
        fontWeight: '700',
        lineHeight: '1.06',
        letterSpacing: '-1px',
        marginBottom: '24px',
        padding: '16px',
        borderRadius: '12px',
        boxShadow: '0   8px 24px rgba(0, 0, 0, 0.25)',
      },
    },
    {
      tag: 'p',
      styles: {
        color: 'rgba(255, 255, 255, 0.6)',
        fontFamily: 'Inter, sans-serif',
        fontSize: '16px',
        fontWeight: '400',
        lineHeight: '24px',
        letterSpacing: 'normal',
        margin: '0px 0px 16px',
        borderRadius: '8px',
        boxShadow: 'none',
      },
    },
  ];

  it('ranks normalized colors by usage and records contributing properties', () => {
    expect(aggregateColors(samples)).toEqual([
      { value: '#000000', count: 2, properties: ['background-color'] },
      { value: '#ffffff', count: 2, properties: ['color'] },
      { value: 'rgba(255, 255, 255, 0.6)', count: 1, properties: ['color'] },
    ]);
  });

  it('groups typography and extracts repeated spacing, radii, and shadows deterministically', () => {
    const analysis = aggregateDesignTokens(samples);

    expect(analysis.typography[0]).toEqual({
      fontFamily: 'Inter, sans-serif',
      fontSize: '64px',
      fontWeight: '700',
      lineHeight: '1.06',
      letterSpacing: '-1px',
      count: 2,
      tags: ['h1', 'h2'],
    });
    expect(analysis.spacing.slice(0, 3)).toEqual([
      { value: '16px', count: 3, properties: ['margin', 'padding'] },
      { value: '24px', count: 2, properties: ['margin-bottom', 'padding'] },
      { value: '0px', count: 1, properties: ['margin'] },
    ]);
    expect(analysis.radii).toEqual([
      { value: '12px', count: 2, properties: ['border-radius'] },
      { value: '8px', count: 1, properties: ['border-radius'] },
    ]);
    expect(analysis.shadows).toEqual([
      {
        value: '0 8px 24px rgba(0, 0, 0, 0.25)',
        count: 2,
        properties: ['box-shadow'],
      },
    ]);
  });
});
