import { Collapsible } from '@base-ui/react/collapsible';
import { DEFAULT_CRAWL_CONFIG, VIEWPORT_PRESETS, type CrawlConfig } from '@sitepull/contracts';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  Folder,
  Globe2,
  History,
  RotateCw,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { RecentCapture } from '@sitepull/contracts';
import type { SitepullController } from '../hooks/use-sitepull.js';
import { cn, formatBytes, normalizeUrlRequestInput, relativeTime } from '../lib/utils.js';
import { Button } from './ui/button.js';
import { Input } from './ui/input.js';

interface EmptyStateProps {
  readonly controller: SitepullController;
}

function freshConfig(): CrawlConfig {
  return {
    ...DEFAULT_CRAWL_CONFIG,
    viewports: DEFAULT_CRAWL_CONFIG.viewports.map((viewport) => ({ ...viewport })),
  };
}

export function EmptyState({ controller }: EmptyStateProps) {
  const { model, startCapture, openRecent, selectOutputDirectory, refreshRecents } = controller;
  const [url, setUrl] = useState('');
  const [outputDirectory, setOutputDirectory] = useState<string | undefined>();
  const [config, setConfig] = useState<CrawlConfig>(freshConfig);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const viewportLabel = useMemo(
    () =>
      config.viewports
        .map((viewport) => viewport.name[0]?.toUpperCase() + viewport.name.slice(1))
        .join(' + '),
    [config.viewports],
  );

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey) || event.defaultPrevented)
        return;
      event.preventDefault();
      formRef.current?.requestSubmit();
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const normalizedInput = normalizeUrlRequestInput(url);
      setUrlError(null);
      setSubmitting(true);
      await startCapture({
        url: normalizedInput.url,
        allowHttpFallback: normalizedInput.protocolInferred,
        config,
        ...(outputDirectory ? { outputDirectory } : {}),
      });
    } catch (error) {
      setUrlError(error instanceof Error ? error.message : 'Enter a valid website URL.');
      setSubmitting(false);
    }
  };

  const chooseOutput = async () => {
    setSettingsError(null);
    try {
      const response = await selectOutputDirectory();
      if (!response.ok) {
        setSettingsError(response.error.message);
        return;
      }
      if (!response.data.cancelled && response.data.path) setOutputDirectory(response.data.path);
    } catch (error) {
      setSettingsError(
        error instanceof Error ? error.message : 'The output folder could not be selected.',
      );
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(circle_at_50%_-20%,rgba(86,105,180,.12),transparent_44%)]">
      <div className="mx-auto flex min-h-full w-full max-w-[920px] flex-col px-6 pb-10 pt-[clamp(54px,9vh,104px)] sm:px-10">
        <section aria-labelledby="pull-heading" className="mx-auto w-full max-w-[700px]">
          <div className="mb-7 text-center">
            <div className="mx-auto mb-5 grid size-11 place-items-center rounded-[12px] border border-white/[0.1] bg-gradient-to-b from-white/[0.09] to-white/[0.025] shadow-[0_14px_40px_rgba(0,0,0,.26),inset_0_1px_0_rgba(255,255,255,.1)]">
              <Globe2 className="size-5 text-blue-300" strokeWidth={1.65} />
            </div>
            <h1
              id="pull-heading"
              className="text-[25px] font-semibold tracking-[-0.035em] text-zinc-100"
            >
              Pull a site
            </h1>
            <p className="mt-1.5 text-[13px] leading-5 text-zinc-500">
              Render the public web into an implementation-ready design reference.
            </p>
          </div>

          <form ref={formRef} onSubmit={(event) => void submit(event)}>
            <div
              className={cn(
                'group relative rounded-[14px] border bg-[#111216] p-1.5 shadow-[0_24px_80px_rgba(0,0,0,.3),inset_0_1px_0_rgba(255,255,255,.025)] transition-[border-color,box-shadow] focus-within:border-blue-400/35 focus-within:shadow-[0_24px_80px_rgba(0,0,0,.38),0_0_0_3px_rgba(59,130,246,.08)]',
                urlError ? 'border-red-400/35' : 'border-white/[0.095]',
              )}
            >
              <div className="flex items-center gap-2">
                <Globe2 className="ml-3 size-[17px] shrink-0 text-zinc-600 transition-colors group-focus-within:text-blue-400" />
                <input
                  autoFocus
                  value={url}
                  onChange={(event) => {
                    setUrl(event.target.value);
                    if (urlError) setUrlError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      formRef.current?.requestSubmit();
                    }
                  }}
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-label="Website URL"
                  aria-invalid={urlError !== null}
                  aria-describedby={urlError ? 'url-error' : 'capture-summary'}
                  placeholder="example.com"
                  className="h-[48px] min-w-0 flex-1 bg-transparent text-[16px] tracking-[-0.015em] text-zinc-100 outline-none placeholder:text-zinc-650"
                />
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  disabled={submitting || url.trim() === ''}
                  className="h-10 rounded-[9px] px-3.5 sm:px-4"
                >
                  <span className="hidden sm:inline">Pull Site</span>
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>

            <div className="mt-2.5 min-h-5 px-1">
              {urlError ? (
                <p id="url-error" role="alert" className="text-[11px] text-red-400">
                  {urlError}
                </p>
              ) : (
                <p id="capture-summary" className="text-[11px] text-zinc-600">
                  Enter a public host or URL. Sitepull tries HTTPS first, then HTTP when needed.
                </p>
              )}
            </div>

            <Collapsible.Root className="mt-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-y border-white/[0.055] px-1 py-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-zinc-500">
                  <span className="text-zinc-400">
                    {config.engine === 'webkit'
                      ? 'WebKit'
                      : config.engine === 'chromium'
                        ? 'Chromium'
                        : 'Firefox'}
                  </span>
                  <span>Depth {config.maxDepth}</span>
                  <span>Max {config.maxPages} pages</span>
                  <span>{viewportLabel}</span>
                </div>
                <Collapsible.Trigger className="settings-trigger flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 outline-none transition-colors hover:bg-white/[0.05] hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-blue-400/50">
                  <Settings2 className="size-3.5" />
                  Advanced
                  <ChevronRight className="settings-chevron size-3.5 transition-transform" />
                </Collapsible.Trigger>
              </div>
              <Collapsible.Panel className="collapsible-panel overflow-hidden">
                <AdvancedSettings
                  config={config}
                  outputDirectory={outputDirectory}
                  outputError={settingsError}
                  onConfigChange={setConfig}
                  onChooseOutput={() => void chooseOutput()}
                  onClearOutput={() => {
                    setOutputDirectory(undefined);
                    setSettingsError(null);
                  }}
                />
              </Collapsible.Panel>
            </Collapsible.Root>
          </form>
        </section>

        <section
          aria-labelledby="recent-heading"
          className="mx-auto mt-[clamp(58px,10vh,92px)] w-full max-w-[760px]"
        >
          <div className="mb-3 flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <History className="size-3.5 text-zinc-600" />
              <h2
                id="recent-heading"
                className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-600"
              >
                Recent captures
              </h2>
            </div>
            <button
              type="button"
              onClick={() => void refreshRecents()}
              className="rounded p-1.5 text-zinc-600 outline-none transition-colors hover:bg-white/[0.05] hover:text-zinc-300 focus-visible:ring-2 focus-visible:ring-blue-400/50"
              aria-label="Refresh recent captures"
              title="Refresh"
            >
              <RotateCw className="size-3.5" />
            </button>
          </div>

          <div className="overflow-hidden rounded-[11px] border border-white/[0.07] bg-white/[0.018]">
            {model.recentsLoading ? (
              <RecentSkeleton />
            ) : model.recents.length > 0 ? (
              model.recents
                .slice(0, 8)
                .map((recent) => (
                  <RecentRow key={recent.captureId} recent={recent} onOpen={openRecent} />
                ))
            ) : (
              <div className="flex min-h-[112px] flex-col items-center justify-center px-5 text-center">
                <Clock3 className="mb-2 size-4 text-zinc-700" />
                <p className="text-[12px] text-zinc-500">
                  Your completed captures will stay within reach here.
                </p>
              </div>
            )}
          </div>
          {model.recentsError ? (
            <p className="mt-2 px-1 text-[11px] text-amber-400/80">{model.recentsError}</p>
          ) : null}
        </section>

        <footer className="mt-auto flex justify-center pt-10">
          <div className="flex items-center gap-1.5 text-[10px] text-zinc-700">
            <ShieldCheck className="size-3" />
            Captures stay on this device
          </div>
        </footer>
      </div>
    </div>
  );
}

interface AdvancedSettingsProps {
  readonly config: CrawlConfig;
  readonly outputDirectory: string | undefined;
  readonly outputError: string | null;
  readonly onConfigChange: (config: CrawlConfig) => void;
  readonly onChooseOutput: () => void;
  readonly onClearOutput: () => void;
}

function AdvancedSettings({
  config,
  outputDirectory,
  outputError,
  onConfigChange,
  onChooseOutput,
  onClearOutput,
}: AdvancedSettingsProps) {
  const set = <K extends keyof CrawlConfig>(key: K, value: CrawlConfig[K]) =>
    onConfigChange({ ...config, [key]: value });

  const toggleViewport = (name: keyof typeof VIEWPORT_PRESETS) => {
    const exists = config.viewports.some((viewport) => viewport.name === name);
    if (exists && config.viewports.length === 1) return;
    set(
      'viewports',
      exists
        ? config.viewports.filter((viewport) => viewport.name !== name)
        : [...config.viewports, { ...VIEWPORT_PRESETS[name] }],
    );
  };

  return (
    <div className="grid gap-x-5 gap-y-5 border-b border-white/[0.055] px-1 pb-5 pt-5 sm:grid-cols-2">
      <Setting
        label="Rendering engine"
        hint="Desktop packages embed WebKit. Optional engines remain available through the CLI."
      >
        <select
          value="webkit"
          disabled
          aria-label="Rendering engine"
          className="h-9 w-full cursor-not-allowed appearance-none rounded-[9px] border border-white/[0.07] bg-[#101116] px-3 text-[12px] text-zinc-400 outline-none"
        >
          <option value="webkit">WebKit · bundled</option>
        </select>
      </Setting>

      <Setting
        group
        label="Viewports"
        hint="Each selection captures viewport and full-page images."
      >
        <div className="flex h-9 items-center gap-1 rounded-[9px] border border-white/[0.09] bg-black/20 p-1">
          {(['desktop', 'mobile', 'tablet'] as const).map((name) => {
            const selected = config.viewports.some((viewport) => viewport.name === name);
            return (
              <button
                key={name}
                type="button"
                onClick={() => toggleViewport(name)}
                aria-pressed={selected}
                className={cn(
                  'flex h-7 flex-1 items-center justify-center gap-1 rounded-[6px] text-[10px] capitalize outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-400/50',
                  selected ? 'bg-white/[0.1] text-zinc-200' : 'text-zinc-600 hover:text-zinc-300',
                )}
              >
                {selected ? <Check className="size-3" /> : null}
                {name}
              </button>
            );
          })}
        </div>
      </Setting>

      <div className="grid grid-cols-2 gap-2 sm:col-span-2 sm:grid-cols-4">
        <NumberSetting
          label="Max depth"
          value={config.maxDepth}
          min={0}
          max={10}
          onChange={(value) => set('maxDepth', value)}
        />
        <NumberSetting
          label="Max pages"
          value={config.maxPages}
          min={1}
          max={500}
          onChange={(value) => set('maxPages', value)}
        />
        <NumberSetting
          label="Timeout (sec)"
          value={config.pageTimeoutMs / 1_000}
          min={1}
          max={300}
          onChange={(value) => set('pageTimeoutMs', value * 1_000)}
        />
        <NumberSetting
          label="Concurrency"
          value={config.crawlConcurrency}
          min={1}
          max={8}
          onChange={(value) => set('crawlConcurrency', value)}
        />
      </div>

      <div className="space-y-2 sm:col-span-2">
        <ToggleRow
          label="Same-origin only"
          description="Keep discovery on the starting origin."
          checked={config.sameOriginOnly}
          onChange={(value) => set('sameOriginOnly', value)}
        />
        <ToggleRow
          label="Include subdomains"
          description="Allow discovered links on sibling subdomains."
          checked={config.includeSubdomains}
          onChange={(value) => set('includeSubdomains', value)}
        />
      </div>

      <Setting
        group
        label="Output directory"
        hint="Leave automatic to use Sitepull's managed capture folder."
        className="sm:col-span-2"
      >
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onChooseOutput}
            aria-describedby={outputError ? 'output-directory-error' : undefined}
            className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[9px] border border-white/[0.09] bg-black/20 px-3 text-left text-[11px] text-zinc-500 outline-none transition-colors hover:border-white/[0.14] hover:text-zinc-300 focus-visible:ring-2 focus-visible:ring-blue-400/50"
          >
            <Folder className="size-3.5 shrink-0" />
            <span className="truncate">{outputDirectory ?? 'Automatic capture folder'}</span>
          </button>
          {outputDirectory ? (
            <Button variant="ghost" size="sm" onClick={onClearOutput}>
              Reset
            </Button>
          ) : null}
        </div>
        {outputError ? (
          <p id="output-directory-error" role="alert" className="mt-1.5 text-[10px] text-red-400">
            {outputError}
          </p>
        ) : null}
      </Setting>
    </div>
  );
}

function Setting({
  label,
  hint,
  children,
  className,
  group = false,
}: {
  readonly label: string;
  readonly hint: string;
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly group?: boolean;
}) {
  if (group) {
    return (
      <fieldset className={cn('m-0 min-w-0 border-0 p-0', className)}>
        <legend className="mb-1.5 block p-0 text-[11px] font-medium text-zinc-300">{label}</legend>
        {children}
        <p className="mt-1.5 text-[10px] leading-4 text-zinc-650">{hint}</p>
      </fieldset>
    );
  }
  return (
    <label className={className}>
      <span className="mb-1.5 block text-[11px] font-medium text-zinc-300">{label}</span>
      {children}
      <span className="mt-1.5 block text-[10px] leading-4 text-zinc-650">{hint}</span>
    </label>
  );
}

function NumberSetting({
  label,
  value,
  min,
  max,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-[10px] text-zinc-500">{label}</span>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value))))}
        className="text-[12px] tabular-nums"
      />
    </label>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 rounded-[9px] border border-white/[0.07] bg-white/[0.018] px-3 py-2 text-left outline-none transition-colors hover:bg-white/[0.035] focus-visible:ring-2 focus-visible:ring-blue-400/50"
    >
      <span
        className={cn(
          'relative h-[18px] w-8 shrink-0 rounded-full border transition-colors',
          checked ? 'border-blue-400/40 bg-blue-500' : 'border-white/[0.12] bg-white/[0.07]',
        )}
      >
        <span
          className={cn(
            'absolute top-[2px] size-3 rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-[16px]' : 'translate-x-[2px]',
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-medium text-zinc-300">{label}</span>
        <span className="block text-[10px] leading-4 text-zinc-600">{description}</span>
      </span>
    </button>
  );
}

function RecentRow({
  recent,
  onOpen,
}: {
  readonly recent: RecentCapture;
  readonly onOpen: (captureId: string) => Promise<void>;
}) {
  const isMissing = recent.availability === 'missing';
  return (
    <button
      type="button"
      disabled={isMissing}
      onClick={() => void onOpen(recent.captureId)}
      className="group flex w-full items-center gap-3 border-b border-white/[0.055] px-3.5 py-3 text-left outline-none transition-colors last:border-b-0 hover:bg-white/[0.035] focus-visible:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400/50 disabled:cursor-default disabled:opacity-55"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-[8px] border border-white/[0.08] bg-black/20 text-[11px] font-semibold uppercase text-zinc-400">
        {recent.hostname.charAt(0)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[12px] font-medium text-zinc-300 transition-colors group-hover:text-zinc-100">
            {recent.hostname}
          </span>
          {isMissing ? (
            <span className="shrink-0 rounded border border-amber-400/15 bg-amber-400/[0.07] px-1.5 py-0.5 text-[9px] text-amber-300/75">
              Folder missing
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-[10px] text-zinc-650">{recent.url}</span>
      </span>
      <span className="hidden items-center gap-3 text-[10px] text-zinc-600 sm:flex">
        <span>{recent.pageCount} pages</span>
        <span>{recent.assetCount} assets</span>
        <span className="w-12 text-right">{formatBytes(recent.byteSize, true)}</span>
      </span>
      <span className="w-[62px] shrink-0 text-right text-[10px] text-zinc-600">
        {relativeTime(recent.capturedAt)}
      </span>
      <ChevronRight className="size-3.5 shrink-0 text-zinc-700 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-400" />
    </button>
  );
}

function RecentSkeleton() {
  return (
    <div aria-label="Loading recent captures">
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="flex items-center gap-3 border-b border-white/[0.05] px-3.5 py-3 last:border-0"
        >
          <div className="skeleton size-8 rounded-[8px]" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-2.5 w-28 rounded" />
            <div className="skeleton h-2 w-48 rounded" />
          </div>
          <div className="skeleton h-2.5 w-16 rounded" />
        </div>
      ))}
    </div>
  );
}
