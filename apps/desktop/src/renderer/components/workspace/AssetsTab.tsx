import type { CaptureManifest, ResourceKind, ResourceManifestEntry } from '@sitepull/contracts';
import { Braces, Code2, File, FileCode2, FileType2, Image, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { cn, fileNameFromUrl, formatBytes } from '../../lib/utils.js';
import { Input } from '../ui/input.js';
import { EmptyPanel } from './shared.js';

type AssetFilter = 'all' | 'images' | 'svg' | 'fonts' | 'css' | 'javascript';
const ASSET_PAGE_SIZE = 120;

const FILTERS: ReadonlyArray<{ value: AssetFilter; label: string; kinds: ResourceKind[] | null }> =
  [
    { value: 'all', label: 'All', kinds: null },
    { value: 'images', label: 'Images', kinds: ['image', 'icon'] },
    { value: 'svg', label: 'SVG', kinds: ['svg'] },
    { value: 'fonts', label: 'Fonts', kinds: ['font'] },
    { value: 'css', label: 'CSS', kinds: ['css'] },
    { value: 'javascript', label: 'JavaScript', kinds: ['javascript'] },
  ];

export function AssetsTab({ manifest }: { readonly manifest: CaptureManifest }) {
  const [filter, setFilter] = useState<AssetFilter>('all');
  const [query, setQuery] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(ASSET_PAGE_SIZE);
  const resources = useMemo(() => {
    const selectedFilter = FILTERS.find((entry) => entry.value === filter);
    const needle = query.trim().toLowerCase();
    return manifest.resources.filter((resource) => {
      if (selectedFilter?.kinds && !selectedFilter.kinds.includes(resource.kind)) return false;
      if (!needle) return true;
      return `${resource.originalUrl} ${resource.localPath ?? ''} ${resource.kind}`
        .toLowerCase()
        .includes(needle);
    });
  }, [filter, manifest.resources, query]);
  const visibleResources = resources.slice(0, visibleLimit);

  return (
    <div className="overflow-hidden rounded-[11px] border border-white/[0.07] bg-white/[0.018]">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] bg-[#0f1014] p-2.5">
        <div className="flex gap-1 overflow-x-auto">
          {FILTERS.map((entry) => {
            const count = manifest.resources.filter(
              (resource) => !entry.kinds || entry.kinds.includes(resource.kind),
            ).length;
            return (
              <button
                key={entry.value}
                type="button"
                onClick={() => {
                  setFilter(entry.value);
                  setVisibleLimit(ASSET_PAGE_SIZE);
                }}
                aria-pressed={filter === entry.value}
                className={cn(
                  'shrink-0 rounded-[7px] px-2.5 py-1.5 text-[10px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-400/50',
                  filter === entry.value
                    ? 'bg-white/[0.09] text-zinc-200'
                    : 'text-zinc-600 hover:bg-white/[0.035] hover:text-zinc-300',
                )}
              >
                {entry.label} <span className="ml-1 text-zinc-700">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="relative ml-auto w-full sm:w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-650" />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setVisibleLimit(ASSET_PAGE_SIZE);
            }}
            placeholder="Filter assets"
            aria-label="Filter assets"
            className="h-8 pl-8 text-[11px]"
          />
        </div>
      </div>

      {resources.length > 0 ? (
        <>
          <div className="grid max-h-[calc(100vh-310px)] min-h-[420px] grid-cols-1 gap-px overflow-auto bg-white/[0.05] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleResources.map((resource, index) => (
              <AssetCard
                key={`${resource.originalUrl}-${resource.sha256 ?? index}`}
                resource={resource}
              />
            ))}
          </div>
          {visibleResources.length < resources.length ? (
            <div className="flex items-center justify-between border-t border-white/[0.06] bg-[#0f1014] px-3 py-2.5 text-[9px] text-zinc-650">
              <span>
                Showing {visibleResources.length} of {resources.length} matching assets
              </span>
              <button
                type="button"
                onClick={() => setVisibleLimit((current) => current + ASSET_PAGE_SIZE)}
                className="rounded-[6px] border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-zinc-400 outline-none hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-blue-400/50"
              >
                Load {Math.min(ASSET_PAGE_SIZE, resources.length - visibleResources.length)} more
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyPanel
          icon={File}
          title="No matching assets"
          detail="Adjust the type filter or search text to inspect a different part of the resource manifest."
        />
      )}
    </div>
  );
}

function AssetCard({ resource }: { readonly resource: ResourceManifestEntry }) {
  const httpError = resource.httpStatus >= 400;
  return (
    <article className="min-w-0 bg-[#0d0e12] p-2.5 transition-colors hover:bg-[#111217]">
      <div className="relative h-[130px] overflow-hidden rounded-[8px] border border-white/[0.07] bg-[#090a0d]">
        <div className="grid h-full place-items-center bg-[radial-gradient(circle_at_50%_42%,rgba(100,120,190,.06),transparent_55%)]">
          <div className="text-center">
            <div className="mx-auto grid size-10 place-items-center rounded-[10px] border border-white/[0.065] bg-white/[0.025]">
              <AssetGlyph kind={resource.kind} />
            </div>
            <p className="mt-2 text-[8px] font-semibold uppercase tracking-[0.1em] text-zinc-750">
              {resource.kind}
            </p>
          </div>
        </div>
        <span
          className={cn(
            'absolute right-1.5 top-1.5 rounded border px-1.5 py-0.5 text-[7px] font-semibold uppercase tracking-[0.08em] backdrop-blur-md',
            httpError
              ? 'border-red-400/15 bg-red-400/[0.08] text-red-300/75'
              : resource.captured
                ? 'border-emerald-400/15 bg-emerald-400/[0.08] text-emerald-300/70'
                : 'border-amber-400/15 bg-amber-400/[0.08] text-amber-300/70',
          )}
        >
          {httpError ? `HTTP ${resource.httpStatus}` : resource.captured ? 'Saved' : 'Skipped'}
        </span>
      </div>
      <div className="px-1 pb-1 pt-2.5">
        <h3
          className="truncate text-[10px] font-medium text-zinc-350"
          title={fileNameFromUrl(resource.originalUrl)}
        >
          {fileNameFromUrl(resource.originalUrl)}
        </h3>
        <p
          className="mt-1 truncate font-mono text-[8px] text-zinc-700"
          title={resource.localPath ?? resource.originalUrl}
        >
          {resource.localPath ?? resource.originalUrl}
        </p>
        <div className="mt-2 flex items-center justify-between text-[8px] text-zinc-700">
          <span>{formatBytes(resource.byteSize)}</span>
          <span>
            {resource.referencedByPages.length}{' '}
            {resource.referencedByPages.length === 1 ? 'page' : 'pages'}
          </span>
          <span>{resource.httpStatus || '—'}</span>
        </div>
      </div>
    </article>
  );
}

function AssetGlyph({ kind }: { readonly kind: ResourceKind }) {
  const className = 'size-5 text-zinc-650';
  if (kind === 'css') return <Braces className={className} />;
  if (kind === 'javascript' || kind === 'source-map') return <Code2 className={className} />;
  if (kind === 'font') return <FileType2 className={className} />;
  if (kind === 'html' || kind === 'json' || kind === 'manifest') {
    return <FileCode2 className={className} />;
  }
  if (kind === 'image' || kind === 'svg' || kind === 'icon') {
    return <Image className={className} />;
  }
  return <File className={className} />;
}
