// @vitest-environment jsdom

import type { CaptureManifest, PageMetrics } from '@sitepull/contracts';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OverviewTab } from './OverviewTab.js';

function manifest(metrics: Partial<PageMetrics>): CaptureManifest {
  return {
    captureId: 'capture-evidence-limits',
    config: { maxElementsPerPage: 10_000 },
    summary: {
      counts: { pages: 1, assets: 0, components: 0, elements: 10_000, bytes: 0 },
      aiPack: null,
    },
    pages: [
      {
        id: 'home',
        route: '/',
        status: 'captured',
        screenshots: [],
        metrics: {
          visibleElements: 10_000,
          discoveredLinks: 0,
          networkRequests: 0,
          capturedResources: 0,
          byteSize: 0,
          durationMs: 100,
          ...metrics,
        },
      },
    ],
    resources: [],
    skippedUrls: [],
    design: { colors: [], typography: [], components: [] },
  } as unknown as CaptureManifest;
}

describe('OverviewTab evidence health', () => {
  it('surfaces element and stylesheet evidence limits instead of claiming completeness', () => {
    const { container } = render(
      <OverviewTab manifest={manifest({ elementsTruncated: true, inaccessibleStylesheets: 2 })} />,
    );

    expect(container.textContent).toContain('Review capture gaps');
    expect(container.textContent).toContain('Pages at element limit');
    expect(container.textContent).toContain('The visible-element inventory reached');
    expect(container.textContent).toContain('2 stylesheet rule lists were inaccessible');
    expect(container.textContent).not.toContain('Capture is internally complete');
  });

  it('surfaces captured resource bodies that returned an HTTP error', () => {
    const errorManifest = {
      ...manifest({ elementsTruncated: false, inaccessibleStylesheets: 0 }),
      resources: [
        {
          originalUrl: 'https://example.com/missing.css',
          httpStatus: 404,
          captured: true,
        },
      ],
    } as unknown as CaptureManifest;

    const { container } = render(<OverviewTab manifest={errorManifest} />);

    expect(container.textContent).toContain('Review capture gaps');
    expect(container.textContent).toContain('Resource HTTP errors');
    expect(container.textContent).toContain('saved error bodies are not valid design evidence');
    expect(container.textContent).not.toContain('Capture is internally complete');
  });
});
