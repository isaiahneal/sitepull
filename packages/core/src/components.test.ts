import { describe, expect, it } from 'vitest';

import {
  aggregateComponentCandidates,
  createDomSignature,
  type DomNodeSnapshot,
  type DomOccurrence,
} from './components.js';

function featureCard(
  text: string,
  id: string,
  classes: readonly string[] = ['feature-card', 'surface'],
): DomNodeSnapshot {
  return {
    tag: 'article',
    id,
    classes,
    styles: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      padding: '24px',
      backgroundColor: 'rgb(20, 20, 22)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '16px',
      boxShadow: '0 8px 30px rgba(0, 0, 0, 0.2)',
    },
    children: [
      { tag: 'h3', text, classes: ['card-title'], styles: { fontWeight: '700' } },
      { tag: 'p', text: `${text} description`, classes: ['card-copy'] },
      { tag: 'a', role: 'link', text: 'Learn more', classes: ['card-link'] },
    ],
  };
}

describe('createDomSignature', () => {
  it('is stable across text, element IDs, generated classes, and class ordering', () => {
    const first = featureCard('Fast capture', 'feature-1', [
      'surface',
      'feature-card',
      'css-a1b2c3d4',
    ]);
    const second = featureCard('Design tokens', 'feature-2', [
      'feature-card',
      'surface',
      'css-ffeedd99',
    ]);

    expect(createDomSignature(first)).toBe(createDomSignature(second));
  });

  it('changes when meaningful structure or stable visual styles change', () => {
    const original = featureCard('Fast capture', 'feature-1');
    const changedStructure: DomNodeSnapshot = {
      ...original,
      children: [...(original.children ?? []), { tag: 'button', role: 'button', text: 'Try it' }],
    };
    const changedStyle: DomNodeSnapshot = {
      ...original,
      styles: { ...original.styles, borderRadius: '4px' },
    };

    expect(createDomSignature(changedStructure)).not.toBe(createDomSignature(original));
    expect(createDomSignature(changedStyle)).not.toBe(createDomSignature(original));
  });
});

describe('aggregateComponentCandidates', () => {
  it('groups repeated patterns, infers a labeled name, and summarizes evidence deterministically', () => {
    const occurrences: DomOccurrence[] = [
      {
        route: '/features',
        domPath: 'main>article:nth-of-type(2)',
        node: featureCard('Design tokens', 'feature-2'),
      },
      {
        route: '/',
        domPath: 'main>article:nth-of-type(1)',
        node: featureCard('Fast capture', 'feature-1'),
      },
      {
        route: '/features',
        domPath: 'main>article:nth-of-type(1)',
        node: featureCard('AI Pack', 'feature-3'),
      },
      {
        route: '/',
        domPath: 'main>aside',
        node: { tag: 'aside', classes: ['unique-promo'], text: 'Once' },
      },
    ];

    const candidates = aggregateComponentCandidates(occurrences);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      suggestedName: 'FeatureCard',
      nameInferred: true,
      occurrences: 3,
      routes: ['/', '/features'],
      styleSummary: {
        display: 'flex',
        gap: '12px',
        padding: '24px',
        'background-color': 'rgb(20, 20, 22)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        'border-radius': '16px',
        'box-shadow': '0 8px 30px rgba(0, 0, 0, 0.2)',
      },
    });
    expect(candidates[0]?.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(candidates[0]?.confidence).toBeGreaterThanOrEqual(0.8);
    expect(candidates[0]?.examples).toEqual([
      { route: '/', domPath: 'main>article:nth-of-type(1)' },
      { route: '/features', domPath: 'main>article:nth-of-type(1)' },
      { route: '/features', domPath: 'main>article:nth-of-type(2)' },
    ]);
  });

  it('honors occurrence and example bounds', () => {
    const occurrences: DomOccurrence[] = [
      { route: '/', domPath: 'button:nth-of-type(1)', node: { tag: 'button', text: 'One' } },
      { route: '/', domPath: 'button:nth-of-type(2)', node: { tag: 'button', text: 'Two' } },
    ];

    expect(aggregateComponentCandidates(occurrences, { minimumOccurrences: 3 })).toEqual([]);
    expect(
      aggregateComponentCandidates(occurrences, { maximumExamples: 1 })[0]?.examples,
    ).toHaveLength(1);
  });
});
