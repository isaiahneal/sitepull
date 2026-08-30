import type { CaptureManifest, PageManifest } from '@sitepull/contracts';
import { Check, Clipboard, ExternalLink, FileCode2, Globe2, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { captureFileUrl, cn, copyText, formatCount, formatDuration } from '../../lib/utils.js';
import { Input } from '../ui/input.js';
import { SegmentedControl } from '../ui/segmented-control.js';
import { ArtifactImage, EmptyPanel } from './shared.js';

type ImageMode = 'viewport' | 'full';

export function PagesTab({ manifest }: { readonly manifest: CaptureManifest }) {
  const [selectedId, setSelectedId] = useState(manifest.pages[0]?.id ?? '');
  const [viewportName, setViewportName] = useState('desktop');
  const [imageMode, setImageMode] = useState<ImageMode>('viewport');
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);

  const filteredPages = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return manifest.pages;
    return manifest.pages.filter(
      (page) =>
        page.route.toLowerCase().includes(needle) || page.title.toLowerCase().includes(needle),
    );
  }, [manifest.pages, query]);

  const selectedPage = manifest.pages.find((page) => page.id === selectedId) ?? manifest.pages[0];
  const availableViewports = selectedPage?.screenshots.map((shot) => shot.viewport.name) ?? [];
  const selectedScreenshot =
    selectedPage?.screenshots.find((shot) => shot.viewport.name === viewportName) ??
    selectedPage?.screenshots[0];

  const selectPage = (page: PageManifest) => {
    setSelectedId(page.id);
    const preferred =
      page.screenshots.find((shot) => shot.viewport.name === viewportName) ?? page.screenshots[0];
    if (preferred) setViewportName(preferred.viewport.name);
  };

  const copyUrl = async () => {
    if (!selectedPage) return;
    try {
      await copyText(selectedPage.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex min-h-[560px] overflow-hidden rounded-[11px] border border-white/[0.07] bg-white/[0.018] max-md:flex-col">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-white/[0.065] bg-[#0d0e12] max-md:w-full max-md:border-b max-md:border-r-0">
        <div className="border-b border-white/[0.06] p-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-650" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter routes"
              aria-label="Filter routes"
              className="h-8 pl-8 text-[11px]"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-1.5 max-md:flex max-md:max-h-32 max-md:gap-1">
          {filteredPages.map((page) => {
            const active = page.id === selectedPage?.id;
            return (
              <button
                key={page.id}
                type="button"
                onClick={() => selectPage(page)}
                aria-label={`${page.route}, ${page.status}, depth ${page.depth}`}
                className={cn(
                  'group flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-400/50 max-md:w-auto max-md:min-w-[150px]',
                  active
                    ? 'bg-white/[0.075] text-zinc-200'
                    : 'text-zinc-500 hover:bg-white/[0.035] hover:text-zinc-300',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    page.status === 'captured'
                      ? 'bg-emerald-400/60'
                      : page.status === 'failed'
                        ? 'bg-red-400/70'
                        : 'bg-zinc-600',
                  )}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-[10px]">{page.route}</span>
                <span className="text-[9px] text-zinc-700">{page.depth}</span>
              </button>
            );
          })}
        </div>
        <div className="border-t border-white/[0.06] px-3 py-2 text-[9px] text-zinc-700 max-md:hidden">
          {filteredPages.length} of {manifest.pages.length} routes
        </div>
      </aside>

      {selectedPage ? (
        <div className="flex min-w-0 flex-1 flex-col bg-[#0a0b0e]">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] bg-[#0f1014] px-3 py-2.5">
            <div className="mr-auto min-w-0">
              <h2 className="max-w-[360px] truncate text-[12px] font-medium text-zinc-250">
                {selectedPage.title || selectedPage.route}
              </h2>
              <p className="mt-0.5 max-w-[440px] truncate text-[9px] text-zinc-650">
                {selectedPage.url}
              </p>
            </div>
            {availableViewports.length > 0 ? (
              <SegmentedControl
                label="Screenshot viewport"
                value={selectedScreenshot?.viewport.name ?? availableViewports[0] ?? 'desktop'}
                segments={availableViewports.map((name) => ({
                  value: name,
                  label: name.charAt(0).toUpperCase() + name.slice(1),
                }))}
                onChange={setViewportName}
              />
            ) : null}
            <SegmentedControl
              label="Screenshot framing"
              value={imageMode}
              segments={[
                { value: 'viewport', label: 'Viewport' },
                { value: 'full', label: 'Full page' },
              ]}
              onChange={setImageMode}
            />
          </div>

          <div className="relative flex min-h-[420px] flex-1 items-start justify-center overflow-auto bg-[linear-gradient(45deg,rgba(255,255,255,.012)_25%,transparent_25%,transparent_75%,rgba(255,255,255,.012)_75%),linear-gradient(45deg,rgba(255,255,255,.012)_25%,transparent_25%,transparent_75%,rgba(255,255,255,.012)_75%)] bg-[length:18px_18px] bg-[position:0_0,9px_9px] p-5">
            {selectedScreenshot ? (
              <ArtifactImage
                src={captureFileUrl(
                  manifest.captureId,
                  imageMode === 'viewport'
                    ? selectedScreenshot.viewportPath
                    : selectedScreenshot.fullPagePath,
                )}
                alt={`${selectedScreenshot.viewport.name} ${imageMode === 'full' ? 'full-page' : 'viewport'} screenshot for ${selectedPage.route}`}
                scrollable={imageMode === 'full'}
                frameClassName={cn(
                  'shrink-0 rounded-[8px] border border-white/[0.1] bg-white shadow-[0_18px_60px_rgba(0,0,0,.4)]',
                  selectedScreenshot.viewport.name === 'mobile'
                    ? 'h-[min(68vh,720px)] w-[min(390px,92%)]'
                    : 'h-[min(68vh,720px)] w-full max-w-[980px]',
                )}
                className={cn('object-top', imageMode === 'full' && 'h-auto object-contain')}
              />
            ) : (
              <div className="grid min-h-[360px] w-full max-w-[800px] place-items-center rounded-lg border border-dashed border-white/[0.08] text-[10px] text-zinc-700">
                No screenshot is recorded for this page
              </div>
            )}
          </div>

          <div className="grid gap-px border-t border-white/[0.06] bg-white/[0.06] sm:grid-cols-[minmax(240px,1.4fr)_repeat(4,minmax(92px,.65fr))]">
            <div className="min-w-0 bg-[#0f1014] px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Globe2 className="size-3.5 shrink-0 text-zinc-600" />
                <a
                  href={selectedPage.url}
                  target="_blank"
                  rel="noreferrer"
                  title="Open original URL in your default browser"
                  className="min-w-0 flex-1 truncate text-[10px] text-blue-400/75 outline-none hover:text-blue-300 hover:underline focus-visible:ring-2 focus-visible:ring-blue-400/50"
                >
                  {selectedPage.url}
                </a>
                <button
                  type="button"
                  onClick={() => void copyUrl()}
                  className="grid size-6 place-items-center rounded text-zinc-650 outline-none hover:bg-white/[0.05] hover:text-zinc-300 focus-visible:ring-2 focus-visible:ring-blue-400/50"
                  aria-label="Copy original URL"
                >
                  {copied ? (
                    <Check className="size-3 text-emerald-400" />
                  ) : (
                    <Clipboard className="size-3" />
                  )}
                </button>
                <ExternalLink className="size-3 text-zinc-700" />
              </div>
            </div>
            <PageMetric label="Status" value={selectedPage.httpStatus?.toString() ?? '—'} />
            <PageMetric
              label="Elements"
              value={formatCount(selectedPage.metrics.visibleElements)}
            />
            <PageMetric
              label="Requests"
              value={formatCount(selectedPage.metrics.networkRequests)}
            />
            <PageMetric label="Duration" value={formatDuration(selectedPage.metrics.durationMs)} />
          </div>
        </div>
      ) : (
        <div className="flex-1">
          <EmptyPanel
            icon={FileCode2}
            title="No captured pages"
            detail="This capture did not produce a readable page manifest."
          />
        </div>
      )}
    </div>
  );
}

function PageMetric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="bg-[#0f1014] px-3 py-2.5">
      <p className="text-[8px] font-semibold uppercase tracking-[0.09em] text-zinc-700">{label}</p>
      <p className="mt-1 truncate text-[10px] tabular-nums text-zinc-400">{value}</p>
    </div>
  );
}
