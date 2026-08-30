import type {
  CrawlConfig,
  DesignManifest,
  PageManifest,
  ResourceManifestEntry,
} from '@sitepull/contracts';

export interface AiContextInput {
  readonly sourceUrl: string;
  readonly capturedAt: string;
  readonly config: CrawlConfig;
  readonly pages: readonly PageManifest[];
  readonly design: DesignManifest;
  readonly resources: readonly ResourceManifestEntry[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function inferredVisualCharacter(design: DesignManifest): string {
  const background = design.colors.find((token) => token.inferredRole === 'page-background');
  const accent = design.colors.find((token) => token.inferredRole === 'accent');
  const radius = design.radii[0];
  const shadow = design.shadows[0];
  const statements = [
    background === undefined
      ? 'No single page-background color was inferred confidently; consult `design/colors.json` for ranked raw evidence.'
      : `The most likely page background is ${background.normalizedValue} (${Math.round((background.confidence ?? 0) * 100)}% inference confidence).`,
    accent === undefined
      ? 'Accent semantics were not inferred confidently from computed styles.'
      : `A likely accent is ${accent.normalizedValue}.`,
    radius === undefined
      ? 'Rounded-surface repetition was not measurable.'
      : `The most frequent measured radius is ${radius.value} (${radius.occurrences} uses).`,
    shadow === undefined
      ? 'No recurring non-default shadow was observed.'
      : `The leading surface shadow recurs ${shadow.occurrences} times.`,
  ];
  return statements.join(' ');
}

function likelyContainerWidth(input: AiContextInput): string {
  const widths = input.design.spacing.filter((token) => token.contexts.includes('max-width'));
  const winner = widths.find((token) => token.pixels !== null && token.pixels >= 600);
  return winner === undefined
    ? 'No dominant content-container cap was inferred; inspect page screenshots and `pages/*/elements.json`.'
    : `Primary content containers appear to cap near ${winner.value}, based on ${winner.occurrences} computed-style observations.`;
}

function routeLines(pages: readonly PageManifest[]): string[] {
  return pages.map(
    (page) =>
      `- \`${page.route}\` — ${page.title || 'Untitled'}; ${page.metrics.visibleElements} visible elements; ${page.screenshots.length} viewport capture(s)`,
  );
}

function pageBreakdown(page: PageManifest): string[] {
  const screenshotList = page.screenshots
    .map(
      (screenshot) =>
        `${screenshot.viewport.name} ${screenshot.viewport.width}×${screenshot.viewport.height}`,
    )
    .join(', ');
  return [
    `### ${page.route}`,
    '',
    `- Source: ${page.url}`,
    `- Title: ${page.title || 'Untitled'}`,
    `- Depth: ${page.depth}`,
    `- Evidence: ${page.metrics.visibleElements} visible elements, ${page.metrics.discoveredLinks} rendered links, ${page.metrics.networkRequests} network requests`,
    `- Screenshots: ${screenshotList || 'none'}`,
    `- Deeper evidence: \`pages/${page.id}/rendered.html\`, \`document.json\`, \`elements.json\`, and \`screenshots/\``,
    '',
  ];
}

export function generateAiContext(input: AiContextInput): string {
  const primaryType = input.design.typography[0];
  const importantAssets = input.resources
    .filter((resource) => resource.captured && ['image', 'svg', 'icon'].includes(resource.kind))
    .sort(
      (left, right) =>
        right.referencedByPages.length - left.referencedByPages.length ||
        right.byteSize - left.byteSize ||
        left.originalUrl.localeCompare(right.originalUrl),
    )
    .slice(0, 18);
  const routes = routeLines(input.pages);
  const lines = [
    '# Sitepull Reference',
    '',
    'This is a browser-delivered semantic reference, not the site’s private or original source repository. Measurements come from rendered DOM and computed-style evidence. Inferences are labeled.',
    '',
    '## Source',
    '',
    `- URL: ${input.sourceUrl}`,
    `- Captured: ${input.capturedAt}`,
    `- Routes captured: ${input.pages.length}`,
    '',
    '## Capture Configuration',
    '',
    `- Engine: ${input.config.engine}`,
    `- Bounded BFS: depth ${input.config.maxDepth}, at most ${input.config.maxPages} pages, concurrency ${input.config.crawlConcurrency}`,
    `- Origin policy: ${input.config.sameOriginOnly ? 'same origin' : 'cross-origin links allowed'}${input.config.includeSubdomains ? ', including subdomains' : ''}`,
    `- Viewports: ${input.config.viewports.map((viewport) => `${viewport.name} ${viewport.width}×${viewport.height}`).join(', ')}`,
    '',
    '## Routes',
    '',
    ...(routes.length === 0 ? ['No route completed successfully.'] : routes),
    '',
    '## Visual Character',
    '',
    inferredVisualCharacter(input.design),
    '',
    '## Layout System',
    '',
    likelyContainerWidth(input),
    `Observed layout evidence spans ${input.pages.reduce((sum, page) => sum + page.metrics.visibleElements, 0).toLocaleString()} visible elements. Use computed flex/grid properties in \`pages/*/elements.json\` for exact reconstruction.`,
    '',
    '## Color System',
    '',
    ...input.design.colors
      .slice(0, 12)
      .map(
        (token) =>
          `- \`${token.normalizedValue}\` — ${token.occurrences} uses${token.inferredRole === null ? '' : `; inferred ${token.inferredRole} (${Math.round((token.confidence ?? 0) * 100)}% confidence)`}`,
      ),
    '',
    '## Typography',
    '',
    ...(primaryType === undefined
      ? ['No repeated typography token was extracted.']
      : [
          `Primary repeated typography: ${primaryType.fontFamily}; ${primaryType.fontSize}; weight ${primaryType.fontWeight}; line-height ${primaryType.lineHeight}; letter-spacing ${primaryType.letterSpacing}.`,
        ]),
    ...input.design.typography
      .slice(0, 10)
      .map(
        (token) =>
          `- ${token.inferredRole === null ? 'Measured style' : `Inferred ${token.inferredRole}`}: ${token.fontSize} / ${token.lineHeight}, ${token.fontWeight}, ${token.occurrences} uses`,
      ),
    '',
    '## Spacing',
    '',
    `Dominant measured values: ${
      input.design.spacing
        .slice(0, 14)
        .map((token) => `${token.value} (${token.occurrences})`)
        .join(', ') || 'none'
    }.`,
    '',
    '## Surfaces',
    '',
    `- Radii: ${
      input.design.radii
        .slice(0, 10)
        .map((token) => `${token.value} (${token.occurrences})`)
        .join(', ') || 'none'
    }`,
    `- Shadows: ${
      input.design.shadows
        .slice(0, 8)
        .map((token) => `${token.value} (${token.occurrences})`)
        .join(', ') || 'none'
    }`,
    `- Borders: ${
      input.design.borders
        .slice(0, 8)
        .map((token) => `${token.value} (${token.occurrences})`)
        .join(', ') || 'none'
    }`,
    '',
    '## Responsive Behavior',
    '',
    `Screenshots were rendered independently at ${input.config.viewports.map((viewport) => `${viewport.width}×${viewport.height}`).join(' and ')}. Accessible stylesheet breakpoints: ${input.design.breakpoints.map((token) => token.mediaQuery).join(', ') || 'none observed'}. Compare matching files in each page’s \`screenshots/\` directory.`,
    '',
    '## Repeated Component Candidates',
    '',
    ...(input.design.components.length === 0
      ? ['No deterministic repeated subtree met the candidate threshold.']
      : input.design.components
          .slice(0, 24)
          .map(
            (candidate) =>
              `- ${candidate.suggestedName} (inferred name): ${candidate.occurrences} occurrences across ${candidate.routes.length} route(s); ${Math.round(candidate.confidence * 100)}% confidence; signature \`${candidate.signature.slice(0, 12)}…\``,
          )),
    '',
    '## Important Assets',
    '',
    ...(importantAssets.length === 0
      ? ['No image/SVG/icon asset was selected.']
      : importantAssets.map(
          (asset) =>
            `- \`${asset.localPath ?? 'not captured'}\` — ${asset.kind}, ${formatBytes(asset.byteSize)}, referenced by ${asset.referencedByPages.length} page(s); source ${asset.originalUrl}`,
        )),
    '',
    '## Page-by-Page Breakdown',
    '',
    ...input.pages.flatMap(pageBreakdown),
    '## Reconstruction Notes',
    '',
    '- Treat the screenshots as the visual authority and computed-style summaries as measurable evidence.',
    '- Rebuild semantic components rather than copying delivered minified JavaScript.',
    '- Inferred component and token names are suggestions; preserve raw values when confidence is low.',
    '- Cross-origin stylesheets may prevent CSS rule enumeration, but their rendered computed styles remain represented on elements.',
    '',
    '## File Map',
    '',
    '- `manifest.json` — complete route/resource/output manifest',
    '- `design/` — ranked colors, type, spacing, radii, shadows, breakpoints, variables, and component candidates',
    '- `pages/*/rendered.html` — DOM after hydration and lazy-content stabilization',
    '- `pages/*/elements.json` — bounded semantic/computed-style evidence',
    '- `pages/*/screenshots/` — viewport and full-page PNG captures',
    '- `assets/` — captured visual/style/font assets, deduplicated by SHA-256',
    '- `raw/` — delivered compiled JavaScript and other raw responses (Full Capture only)',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

export function generatedCaptureReadme(sourceUrl: string): string {
  return `# Sitepull Capture\n\nCaptured from ${sourceUrl}.\n\nStart with [AI_CONTEXT.md](./AI_CONTEXT.md), then use [manifest.json](./manifest.json) and the evidence under \`pages/\` and \`design/\`.\n\nSitepull captures and analyzes content delivered to a browser. It does not magically recover a website's private/original source repository.\n`;
}
