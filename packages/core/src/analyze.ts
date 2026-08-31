import { DesignManifestSchema } from '@sitepull/contracts';
import type {
  BorderToken,
  BreakpointToken,
  ColorRole,
  ColorToken,
  ComponentCandidate as ContractComponentCandidate,
  CssVariableToken,
  DesignManifest,
  ElementRecord,
  MeasurementToken,
  ShadowToken,
  SpacingToken,
  TypographyRole,
  TypographyToken as ContractTypographyToken,
} from '@sitepull/contracts';

import { aggregateComponentCandidates, type DomOccurrence } from './components.js';
import { aggregateDesignTokens, type ComputedStyleSample, type FrequencyToken } from './design.js';

export interface AnalyzablePage {
  readonly route: string;
  readonly elements: readonly ElementRecord[];
  readonly cssVariables: Readonly<Record<string, readonly string[]>>;
  readonly breakpoints: readonly string[];
}

function pxValue(value: string): number | null {
  const match = /^(-?\d+(?:\.\d+)?)px$/u.exec(value.trim());
  return match?.[1] === undefined ? null : Number.parseFloat(match[1]);
}

function tokenRoutes(pages: readonly AnalyzablePage[]): string[] {
  return [...new Set(pages.map((page) => page.route))].sort();
}

function inferredColorRole(
  token: FrequencyToken,
  rank: number,
): { role: ColorRole; confidence: number } | null {
  const properties = new Set(token.properties);
  if (
    properties.has('border-color') &&
    token.properties.every((property) => property.includes('border'))
  ) {
    return { role: 'border', confidence: 0.64 };
  }
  if (properties.has('background-color') && rank < 3) {
    return {
      role: rank === 0 ? 'page-background' : 'surface',
      confidence: rank === 0 ? 0.6 : 0.52,
    };
  }
  if (properties.has('color') && rank < 3) {
    return {
      role: rank === 0 ? 'primary-text' : 'secondary-text',
      confidence: rank === 0 ? 0.68 : 0.55,
    };
  }
  return null;
}

function typographyRole(token: {
  fontSize: string;
  tags: readonly string[];
}): { role: TypographyRole; confidence: number } | null {
  const tags = new Set(token.tags.map((tag) => tag.toLowerCase()));
  if (tags.has('h1'))
    return {
      role:
        pxValue(token.fontSize) !== null && (pxValue(token.fontSize) ?? 0) >= 48 ? 'display' : 'h1',
      confidence: 0.82,
    };
  if (tags.has('h2')) return { role: 'h2', confidence: 0.8 };
  if (tags.has('h3')) return { role: 'h3', confidence: 0.8 };
  const pixels = pxValue(token.fontSize);
  if (tags.has('p') || tags.has('body')) return { role: 'body', confidence: 0.72 };
  if (pixels !== null && pixels <= 12) return { role: 'caption', confidence: 0.58 };
  if (pixels !== null && pixels <= 14) return { role: 'small', confidence: 0.55 };
  return null;
}

function spacingMeasurements(
  tokens: readonly FrequencyToken[],
  routes: readonly string[],
): SpacingToken[] {
  return tokens.map((token) => ({
    value: token.value,
    pixels: pxValue(token.value),
    occurrences: token.count,
    contexts: [...token.properties],
    routes: [...routes],
  }));
}

function nonnegativeMeasurements(
  tokens: readonly FrequencyToken[],
  routes: readonly string[],
): MeasurementToken[] {
  return tokens.map((token) => ({
    value: token.value,
    pixels: pxValue(token.value),
    occurrences: token.count,
    contexts: [...token.properties],
    routes: [...routes],
  }));
}

function mergeCssVariables(pages: readonly AnalyzablePage[]): CssVariableToken[] {
  const values = new Map<
    string,
    { values: Set<string>; routes: Set<string>; occurrences: number }
  >();
  for (const page of pages) {
    for (const [name, pageValues] of Object.entries(page.cssVariables)) {
      const token = values.get(name) ?? {
        values: new Set<string>(),
        routes: new Set<string>(),
        occurrences: 0,
      };
      for (const value of pageValues) token.values.add(value);
      token.routes.add(page.route);
      token.occurrences += 1;
      values.set(name, token);
    }
  }
  return [...values.entries()]
    .map(([name, token]) => ({
      name,
      values: [...token.values].sort(),
      occurrences: token.occurrences,
      routes: [...token.routes].sort(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function parseBreakpoint(query: string): BreakpointToken {
  const minimum = /min-width\s*:\s*([\d.]+)px/iu.exec(query)?.[1];
  const maximum = /max-width\s*:\s*([\d.]+)px/iu.exec(query)?.[1];
  return {
    mediaQuery: query,
    minWidthPx: minimum === undefined ? null : Number.parseFloat(minimum),
    maxWidthPx: maximum === undefined ? null : Number.parseFloat(maximum),
    occurrences: 1,
  };
}

function aggregateBreakpoints(pages: readonly AnalyzablePage[]): BreakpointToken[] {
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const query of page.breakpoints) counts.set(query, (counts.get(query) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([query, occurrences]) => ({ ...parseBreakpoint(query), occurrences }))
    .sort((left, right) => left.mediaQuery.localeCompare(right.mediaQuery));
}

function aggregateBorders(pages: readonly AnalyzablePage[]): BorderToken[] {
  const tokens = new Map<string, { count: number; routes: Set<string> }>();
  for (const page of pages) {
    for (const element of page.elements) {
      const value = element.styles.border?.trim();
      if (
        value === undefined ||
        value === '' ||
        value === '0px none rgb(0, 0, 0)' ||
        value === 'none'
      )
        continue;
      const token = tokens.get(value) ?? { count: 0, routes: new Set<string>() };
      token.count += 1;
      token.routes.add(page.route);
      tokens.set(value, token);
    }
  }
  return [...tokens.entries()]
    .map(([value, token]) => ({
      value,
      occurrences: token.count,
      routes: [...token.routes].sort(),
    }))
    .sort(
      (left, right) =>
        right.occurrences - left.occurrences || left.value.localeCompare(right.value),
    );
}

function componentsForPages(pages: readonly AnalyzablePage[]): ContractComponentCandidate[] {
  const occurrences: DomOccurrence[] = [];
  for (const page of pages) {
    for (const element of page.elements) {
      if (
        element.classes.length === 0 &&
        !['article', 'button', 'footer', 'header', 'nav', 'section'].includes(element.tag) &&
        element.role === null
      ) {
        continue;
      }
      occurrences.push({
        route: page.route,
        domPath: element.domPath,
        node: {
          tag: element.tag,
          role: element.role,
          text: element.text,
          id: element.id,
          classes: element.classes,
          styles: element.styles,
        },
      });
    }
  }
  return aggregateComponentCandidates(occurrences, { minimumOccurrences: 2, maximumExamples: 5 })
    .slice(0, 80)
    .map((candidate) => ({
      suggestedName: candidate.suggestedName,
      nameIsInferred: true,
      confidence: candidate.confidence,
      occurrences: candidate.occurrences,
      routes: [...candidate.routes],
      signature: candidate.signature,
      styleSummary: candidate.styleSummary,
      examples: candidate.examples.map((example) => ({
        route: example.route,
        domPath: example.domPath,
      })),
    }));
}

export function analyzeSiteDesign(pages: readonly AnalyzablePage[]): DesignManifest {
  const samples: ComputedStyleSample[] = pages.flatMap((page) =>
    page.elements.map((element) => ({
      route: page.route,
      tag: element.tag,
      role: element.role,
      styles: element.styles,
    })),
  );
  const analysis = aggregateDesignTokens(samples);
  const routes = tokenRoutes(pages);
  const colors: ColorToken[] = analysis.colors.map((token, rank) => {
    const inference = inferredColorRole(token, rank);
    return {
      normalizedValue: token.value,
      rawValues: [token.value],
      occurrences: token.count,
      routes: [...routes],
      inferredRole: inference?.role ?? null,
      confidence: inference?.confidence ?? null,
    };
  });
  const typography: ContractTypographyToken[] = analysis.typography.map((token) => {
    const inference = typographyRole(token);
    return {
      fontFamily: token.fontFamily,
      fontSize: token.fontSize,
      fontWeight: token.fontWeight,
      lineHeight: token.lineHeight,
      letterSpacing: token.letterSpacing,
      occurrences: token.count,
      routes: [...routes],
      inferredRole: inference?.role ?? null,
      confidence: inference?.confidence ?? null,
    };
  });
  const shadows: ShadowToken[] = analysis.shadows.map((token) => ({
    value: token.value,
    occurrences: token.count,
    routes: [...routes],
  }));

  return DesignManifestSchema.parse({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourcePageCount: pages.length,
    colors,
    typography,
    spacing: spacingMeasurements(analysis.spacing, routes),
    radii: nonnegativeMeasurements(analysis.radii, routes),
    shadows,
    borders: aggregateBorders(pages),
    breakpoints: aggregateBreakpoints(pages),
    cssVariables: mergeCssVariables(pages),
    components: componentsForPages(pages),
  });
}

export function designSystemMarkdown(design: DesignManifest): string {
  const lines = [
    '# Extracted Design System',
    '',
    `Evidence aggregated from ${design.sourcePageCount} rendered page${design.sourcePageCount === 1 ? '' : 's'}. Inferred roles are explicitly labeled and retain confidence scores.`,
    '',
    '## Colors',
    '',
    ...design.colors
      .slice(0, 16)
      .map(
        (token) =>
          `- \`${token.normalizedValue}\` — ${token.occurrences} uses${token.inferredRole === null ? '' : `; inferred ${token.inferredRole} (${Math.round((token.confidence ?? 0) * 100)}% confidence)`}`,
      ),
    '',
    '## Typography',
    '',
    ...design.typography
      .slice(0, 14)
      .map(
        (token) =>
          `- ${token.inferredRole === null ? 'Measured style' : `Inferred ${token.inferredRole}`}: ${token.fontFamily}; ${token.fontSize}; ${token.fontWeight}; line-height ${token.lineHeight}; ${token.occurrences} uses`,
      ),
    '',
    '## Spacing',
    '',
    ...design.spacing
      .slice(0, 16)
      .map(
        (token) =>
          `- \`${token.value}\` — ${token.occurrences} uses (${token.contexts.join(', ')})`,
      ),
    '',
    '## Surfaces',
    '',
    `- Repeated radii: ${
      design.radii
        .slice(0, 10)
        .map((token) => `\`${token.value}\` (${token.occurrences})`)
        .join(', ') || 'none observed'
    }`,
    `- Repeated shadows: ${
      design.shadows
        .slice(0, 8)
        .map((token) => `\`${token.value}\` (${token.occurrences})`)
        .join(', ') || 'none observed'
    }`,
    `- Repeated borders: ${
      design.borders
        .slice(0, 8)
        .map((token) => `\`${token.value}\` (${token.occurrences})`)
        .join(', ') || 'none observed'
    }`,
    '',
    '## Breakpoints',
    '',
    ...(design.breakpoints.length === 0
      ? ['No accessible media-query breakpoints were observed.']
      : design.breakpoints.map(
          (token) => `- \`${token.mediaQuery}\` — seen on ${token.occurrences} page(s)`,
        )),
    '',
    '## Component Candidates',
    '',
    ...(design.components.length === 0
      ? ['No repeated candidates met the deterministic confidence threshold.']
      : design.components
          .slice(0, 24)
          .map(
            (candidate) =>
              `- ${candidate.suggestedName} (inferred): ${candidate.occurrences} occurrences, ${Math.round(candidate.confidence * 100)}% confidence`,
          )),
    '',
  ];
  return `${lines.join('\n')}\n`;
}
