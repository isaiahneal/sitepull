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
  return pages.map((page) => {
    if (page.status !== 'captured') {
      const attempts = page.attempts?.length ?? 1;
      const reason = page.errors[0]?.message ?? 'Capture failed without detailed evidence.';
      return `- \`${page.route}\` — **failed** after ${attempts} attempt(s); ${reason}`;
    }
    const recovered = page.attempts?.some((attempt) => attempt.outcome === 'retrying') ?? false;
    return `- \`${page.route}\` — ${page.title || 'Untitled'}; ${page.metrics.visibleElements} visible elements; ${page.screenshots.length} viewport capture(s)${recovered ? `; recovered after ${page.attempts?.length ?? 1} attempts` : ''}`;
  });
}

function captureCoverage(input: AiContextInput): string[] {
  const capturedPages = input.pages.filter((page) => page.status === 'captured');
  const failedPages = input.pages.filter((page) => page.status === 'failed');
  const recoveredPages = capturedPages.filter(
    (page) => page.attempts?.some((attempt) => attempt.outcome === 'retrying') ?? false,
  );
  const capturedResources = input.resources.filter((resource) => resource.captured);
  const unavailableResources = input.resources.filter((resource) => !resource.captured);
  const httpErrorResources = input.resources.filter((resource) => resource.httpStatus >= 400);
  const truncatedElementPages = capturedPages.filter(
    (page) => page.metrics.elementsTruncated === true,
  );
  const inaccessibleStylesheetPages = capturedPages.filter(
    (page) => (page.metrics.inaccessibleStylesheets ?? 0) > 0,
  );
  const inaccessibleStylesheets = inaccessibleStylesheetPages.reduce(
    (total, page) => total + (page.metrics.inaccessibleStylesheets ?? 0),
    0,
  );
  const unreportedElementPages = capturedPages.filter(
    (page) => page.metrics.elementsTruncated === undefined,
  );
  const unreportedStylesheetPages = capturedPages.filter(
    (page) => page.metrics.inaccessibleStylesheets === undefined,
  );
  const elementInventoryCoverage = [
    ...(truncatedElementPages.length === 0
      ? []
      : [
          `${truncatedElementPages.length} captured page(s) reached the configured ${input.config.maxElementsPerPage.toLocaleString('en-US')}-visible-element bound (${truncatedElementPages.map((page) => `\`${page.route}\``).join(', ')})`,
        ]),
    ...(unreportedElementPages.length === 0
      ? []
      : [
          `truncation telemetry is unavailable for ${unreportedElementPages.length} legacy page record(s) (${unreportedElementPages.map((page) => `\`${page.route}\``).join(', ')})`,
        ]),
  ].join('; ');
  const stylesheetCoverage = [
    ...(inaccessibleStylesheets === 0
      ? []
      : [
          `${inaccessibleStylesheets} rule list(s) across ${inaccessibleStylesheetPages.length} captured page(s) were inaccessible (${inaccessibleStylesheetPages.map((page) => `\`${page.route}\``).join(', ')}); computed styles for captured elements remain available, but CSS variables and media rules may be incomplete`,
        ]),
    ...(unreportedStylesheetPages.length === 0
      ? []
      : [
          `access telemetry is unavailable for ${unreportedStylesheetPages.length} legacy page record(s) (${unreportedStylesheetPages.map((page) => `\`${page.route}\``).join(', ')})`,
        ]),
  ].join('; ');
  const complete =
    failedPages.length === 0 &&
    unavailableResources.length === 0 &&
    httpErrorResources.length === 0 &&
    truncatedElementPages.length === 0 &&
    inaccessibleStylesheets === 0 &&
    unreportedElementPages.length === 0 &&
    unreportedStylesheetPages.length === 0;
  return [
    `- Overall: **${complete ? 'no recorded page, resource, or extraction-evidence gaps' : 'partial; review the gaps below before treating this pack as complete'}**`,
    `- Pages: ${capturedPages.length} captured of ${input.pages.length} attempted; ${failedPages.length} failed`,
    `- Resources: ${capturedResources.length} bodies captured of ${input.resources.length} cataloged; ${unavailableResources.length} unavailable or excluded by a safety limit; ${httpErrorResources.length} returned HTTP error status`,
    `- Retry recovery: ${recoveredPages.length} page(s) succeeded after at least one retry`,
    `- Element inventories: ${elementInventoryCoverage || 'no captured page reached the configured visible-element bound'}`,
    `- Stylesheet enumeration: ${stylesheetCoverage || 'no inaccessible stylesheet rule lists were recorded'}`,
    ...(failedPages.length === 0
      ? []
      : [`- Failed routes: ${failedPages.map((page) => `\`${page.route}\``).join(', ')}`]),
    ...(unavailableResources.length === 0
      ? []
      : [
          `- Resource gap examples: ${unavailableResources
            .slice(0, 5)
            .map(
              (resource) =>
                `\`${resource.originalUrl}\` (${resource.failureReason ?? 'body unavailable'})`,
            )
            .join('; ')}`,
        ]),
    ...(httpErrorResources.length === 0
      ? []
      : [
          `- Resource HTTP-error examples: ${httpErrorResources
            .slice(0, 5)
            .map(
              (resource) =>
                `\`${resource.originalUrl}\` (HTTP ${resource.httpStatus}${resource.captured ? '; error body saved' : '; body unavailable'})`,
            )
            .join('; ')}`,
        ]),
  ];
}

function pageBreakdown(page: PageManifest): string[] {
  const screenshotList = page.screenshots
    .map(
      (screenshot) =>
        `${screenshot.viewport.name} ${screenshot.viewport.width}×${screenshot.viewport.height}`,
    )
    .join(', ');
  const evidenceLimits = [
    ...(page.metrics.elementsTruncated === true ? ['visible-element inventory truncated'] : []),
    ...(page.metrics.elementsTruncated === undefined
      ? ['element-truncation telemetry unavailable (legacy manifest)']
      : []),
    ...((page.metrics.inaccessibleStylesheets ?? 0) > 0
      ? [
          `${page.metrics.inaccessibleStylesheets} inaccessible stylesheet rule list${page.metrics.inaccessibleStylesheets === 1 ? '' : 's'}`,
        ]
      : []),
    ...(page.metrics.inaccessibleStylesheets === undefined
      ? ['stylesheet-access telemetry unavailable (legacy manifest)']
      : []),
  ];
  return [
    `### ${page.route}`,
    '',
    `- Source: ${page.url}`,
    `- Status: ${page.status}`,
    `- Title: ${page.title || 'Untitled'}`,
    `- Depth: ${page.depth}`,
    `- Attempts: ${page.attempts?.length ?? 1}`,
    `- Evidence: ${page.metrics.visibleElements} visible elements, ${page.metrics.discoveredLinks} rendered links, ${page.metrics.networkRequests} network requests`,
    ...(page.status === 'captured'
      ? [
          `- Evidence limits: ${evidenceLimits.length === 0 ? 'no element truncation or inaccessible stylesheet rule lists recorded' : evidenceLimits.join('; ')}`,
        ]
      : []),
    `- Screenshots: ${screenshotList || 'none'}`,
    ...(page.files === null
      ? [
          `- Failure: ${page.errors[0]?.message ?? 'No detailed page error was recorded.'}`,
          '- Deeper evidence: no rendered page artifact was committed for this failed route',
        ]
      : [
          `- Deeper evidence: \`pages/${page.id}/rendered.html\`, \`document.json\`, \`elements.json\`, and \`screenshots/\``,
        ]),
    '',
  ];
}

export function generateAiContext(input: AiContextInput): string {
  const capturedPages = input.pages.filter((page) => page.status === 'captured');
  const primaryType = input.design.typography[0];
  const importantAssets = input.resources
    .filter(
      (resource) =>
        resource.captured &&
        resource.httpStatus < 400 &&
        ['image', 'svg', 'icon'].includes(resource.kind),
    )
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
    `- Routes captured: ${capturedPages.length} of ${input.pages.length} attempted`,
    '',
    '## Capture Coverage',
    '',
    ...captureCoverage(input),
    '',
    '## Capture Configuration',
    '',
    `- Engine: ${input.config.engine}`,
    `- Bounded BFS: depth ${input.config.maxDepth}, at most ${input.config.maxPages} pages, concurrency ${input.config.crawlConcurrency}`,
    `- Resource body limits: ${formatBytes(input.config.maxResourceBytes)} per response, ${formatBytes(input.config.maxCaptureResourceBytes)} aggregate, ${input.config.resourceBodyConcurrency} concurrent body reads`,
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
    `Observed layout evidence spans ${capturedPages.reduce((sum, page) => sum + page.metrics.visibleElements, 0).toLocaleString()} visible elements. Use computed flex/grid properties in \`pages/*/elements.json\` for exact reconstruction.`,
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
    `Screenshots were captured at ${input.config.viewports.map((viewport) => `${viewport.width}×${viewport.height}`).join(' and ')} after resizing the stabilized page. Accessible stylesheet breakpoints: ${input.design.breakpoints.map((token) => token.mediaQuery).join(', ') || 'none observed'}. Compare matching files in each page’s \`screenshots/\` directory. JavaScript or server behavior that branches only at initial viewport load may require a separate viewport-specific capture.`,
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
    '- Cross-origin stylesheets may prevent CSS rule enumeration; computed styles remain represented for captured elements, subject to the per-page element bound.',
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
