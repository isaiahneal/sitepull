import type { CaptureManifest, ScreenshotManifest } from '@sitepull/contracts';
import { Box, Braces, FileArchive, Globe2, Layers3, Type } from 'lucide-react';

import { captureFileUrl, formatBytes, formatCount, safeCssColor } from '../../lib/utils.js';
import { ArtifactImage, ConfidenceBar, SectionHeading, WorkspacePanel } from './shared.js';

export function OverviewTab({ manifest }: { readonly manifest: CaptureManifest }) {
  const page = manifest.pages.find((entry) => entry.status === 'captured') ?? manifest.pages[0];
  const primaryScreenshot =
    page?.screenshots.find((shot) => shot.viewport.name === 'desktop') ?? page?.screenshots[0];
  const secondaryScreenshot =
    page?.screenshots.find(
      (shot) => shot.viewport.name === 'mobile' && shot !== primaryScreenshot,
    ) ?? page?.screenshots.find((shot) => shot !== primaryScreenshot);
  const topColors = manifest.design.colors.slice(0, 8);
  const topTypography = manifest.design.typography.slice(0, 4);
  const components = manifest.design.components.slice(0, 5);
  const routes = manifest.pages.slice(0, 10);

  return (
    <div className="grid gap-5 pb-8">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <SummaryMetric
          icon={Globe2}
          value={formatCount(manifest.summary.counts.pages)}
          label="Pages"
        />
        <SummaryMetric
          icon={Box}
          value={formatCount(manifest.summary.counts.assets)}
          label="Assets"
        />
        <SummaryMetric
          icon={Layers3}
          value={formatCount(manifest.summary.counts.components)}
          label="Components"
        />
        <SummaryMetric
          icon={Braces}
          value={formatCount(manifest.summary.counts.elements)}
          label="Elements"
        />
        <SummaryMetric
          icon={FileArchive}
          value={
            manifest.summary.aiPack ? formatBytes(manifest.summary.aiPack.estimatedBytes) : '—'
          }
          label="AI Pack"
          className="col-span-2 lg:col-span-1"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,.55fr)]">
        <WorkspacePanel className="overflow-hidden">
          <div className="border-b border-white/[0.06] px-4 py-3">
            <SectionHeading
              eyebrow={page?.route ?? '/'}
              title="Responsive capture"
              aside={<span className="text-[10px] text-zinc-650">Viewport</span>}
            />
          </div>
          <div className="grid min-h-[390px] gap-px bg-white/[0.06] sm:grid-cols-[minmax(0,1fr)_200px]">
            <ScreenshotPreview
              captureId={manifest.captureId}
              screenshot={primaryScreenshot}
              label={viewportLabel(primaryScreenshot, 'Primary')}
              route={page?.route ?? '/'}
            />
            <ScreenshotPreview
              captureId={manifest.captureId}
              screenshot={secondaryScreenshot}
              label={viewportLabel(secondaryScreenshot, 'Additional viewport')}
              route={page?.route ?? '/'}
            />
          </div>
        </WorkspacePanel>

        <div className="grid content-start gap-5">
          <WorkspacePanel className="p-4">
            <SectionHeading
              eyebrow="Extracted"
              title="Dominant palette"
              aside={
                <span className="text-[10px] text-zinc-650">
                  {manifest.design.colors.length} colors
                </span>
              }
            />
            <div className="mt-4 grid grid-cols-4 gap-2">
              {topColors.map((color) => (
                <div
                  key={color.normalizedValue}
                  title={`${color.normalizedValue} · ${color.occurrences} uses`}
                >
                  <div
                    className="aspect-square rounded-[7px] border border-white/[0.1] shadow-[inset_0_0_0_1px_rgba(0,0,0,.14)]"
                    style={{ backgroundColor: safeCssColor(color.normalizedValue) }}
                  />
                  <p className="mt-1 truncate font-mono text-[8px] text-zinc-650">
                    {color.normalizedValue}
                  </p>
                </div>
              ))}
            </div>
          </WorkspacePanel>

          <WorkspacePanel className="p-4">
            <SectionHeading
              eyebrow="Routes"
              title="Captured pages"
              aside={<span className="text-[10px] text-zinc-650">{manifest.pages.length}</span>}
            />
            <div className="mt-3 space-y-0.5">
              {routes.map((route) => (
                <div
                  key={route.id}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-[10px] hover:bg-white/[0.03]"
                >
                  <span
                    aria-hidden="true"
                    className={
                      route.status === 'captured'
                        ? 'size-1.5 rounded-full bg-emerald-400/60'
                        : route.status === 'failed'
                          ? 'size-1.5 rounded-full bg-red-400/70'
                          : 'size-1.5 rounded-full bg-zinc-600'
                    }
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-zinc-400">
                    {route.route}
                  </span>
                  <span
                    className={
                      route.status === 'captured'
                        ? 'capitalize text-emerald-400/55'
                        : route.status === 'failed'
                          ? 'capitalize text-red-400/65'
                          : 'capitalize text-zinc-650'
                    }
                  >
                    {route.status}
                  </span>
                  <span className="text-zinc-700">{formatBytes(route.metrics.byteSize, true)}</span>
                </div>
              ))}
              {manifest.pages.length > routes.length ? (
                <p className="px-1.5 pt-1 text-[9px] text-zinc-700">
                  +{manifest.pages.length - routes.length} more routes
                </p>
              ) : null}
            </div>
          </WorkspacePanel>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <WorkspacePanel className="p-4">
          <SectionHeading
            eyebrow="Typography"
            title="Repeated type treatments"
            aside={<Type className="size-3.5 text-zinc-650" />}
          />
          <div className="mt-4 divide-y divide-white/[0.055]">
            {topTypography.map((token, index) => (
              <div
                key={`${token.fontFamily}-${token.fontSize}-${token.fontWeight}`}
                className="grid grid-cols-[minmax(0,1fr)_90px] items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p
                    className="truncate text-zinc-200"
                    style={{
                      fontFamily: token.fontFamily,
                      fontSize: `${Math.min(Number.parseFloat(token.fontSize) || 14, 24)}px`,
                      fontWeight: token.fontWeight,
                    }}
                  >
                    {token.inferredRole ?? `Style ${index + 1}`}
                  </p>
                  <p className="mt-1 truncate text-[9px] text-zinc-650">{token.fontFamily}</p>
                </div>
                <div className="text-right font-mono text-[9px] leading-4 text-zinc-600">
                  <div>
                    {token.fontSize} / {token.lineHeight}
                  </div>
                  <div>weight {token.fontWeight}</div>
                </div>
              </div>
            ))}
          </div>
        </WorkspacePanel>

        <WorkspacePanel className="p-4">
          <SectionHeading
            eyebrow="Inferred"
            title="Top component candidates"
            aside={<span className="text-[10px] text-zinc-650">Deterministic</span>}
          />
          <div className="mt-3 space-y-1">
            {components.map((component) => (
              <div
                key={component.signature}
                className="rounded-[8px] border border-transparent px-2 py-2 hover:border-white/[0.06] hover:bg-white/[0.025]"
              >
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="text-[11px] font-medium text-zinc-300">
                    {component.suggestedName}
                  </span>
                  <span className="text-[9px] text-zinc-650">
                    {component.occurrences} occurrences
                  </span>
                </div>
                <ConfidenceBar confidence={component.confidence} />
              </div>
            ))}
          </div>
        </WorkspacePanel>
      </div>
    </div>
  );
}

function SummaryMetric({
  icon: Icon,
  value,
  label,
  className,
}: {
  readonly icon: typeof Globe2;
  readonly value: string;
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <WorkspacePanel className={`px-3 py-3 ${className ?? ''}`}>
      <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-650">
        <Icon className="size-3" /> {label}
      </div>
      <p className="mt-1.5 text-[15px] font-medium tracking-[-0.025em] text-zinc-200 tabular-nums">
        {value}
      </p>
    </WorkspacePanel>
  );
}

function ScreenshotPreview({
  captureId,
  screenshot,
  label,
  route,
}: {
  readonly captureId: string;
  readonly screenshot: ScreenshotManifest | undefined;
  readonly label: string;
  readonly route: string;
}) {
  return (
    <div className="relative min-h-[360px] bg-[#0c0d10] p-3">
      <div className="absolute left-5 top-5 z-10 rounded-md border border-black/30 bg-black/70 px-2 py-1 text-[9px] font-medium text-zinc-300 backdrop-blur-md">
        {label}
      </div>
      {screenshot ? (
        <ArtifactImage
          src={captureFileUrl(captureId, screenshot.viewportPath)}
          alt={`${label} screenshot of ${route}`}
          frameClassName="h-full min-h-[360px] rounded-[8px] border border-white/[0.08] shadow-[0_14px_40px_rgba(0,0,0,.28)]"
          className="object-cover object-top"
        />
      ) : (
        <div className="grid h-full min-h-[360px] place-items-center rounded-[8px] border border-dashed border-white/[0.08] text-[10px] text-zinc-700">
          Viewport was not captured
        </div>
      )}
    </div>
  );
}

function viewportLabel(screenshot: ScreenshotManifest | undefined, fallback: string): string {
  const name = screenshot?.viewport.name;
  return name ? `${name.charAt(0).toUpperCase()}${name.slice(1)}` : fallback;
}
