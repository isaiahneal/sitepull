import { Collapsible } from '@base-ui/react/collapsible';
import type { CaptureStage, LogEvent, ProgressCounters } from '@sitepull/contracts';
import {
  Activity,
  Box,
  Braces,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  FileText,
  Globe2,
  HardDrive,
  LoaderCircle,
  OctagonX,
  Timer,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { SitepullController } from '../hooks/use-sitepull.js';
import { captureElapsedMs, cn, formatBytes, formatCount, formatDuration } from '../lib/utils.js';
import { Button } from './ui/button.js';

const STAGES: ReadonlyArray<{ stage: CaptureStage; label: string }> = [
  { stage: 'normalizing-url', label: 'Preparing URL' },
  { stage: 'launching-browser', label: 'Launching browser' },
  { stage: 'rendering', label: 'Rendering' },
  { stage: 'discovering-routes', label: 'Discovering routes' },
  { stage: 'crawling-pages', label: 'Crawling pages' },
  { stage: 'capturing-assets', label: 'Capturing assets' },
  { stage: 'extracting-styles', label: 'Extracting styles' },
  { stage: 'analyzing-design-system', label: 'Analyzing design system' },
  { stage: 'building-ai-pack', label: 'Building AI Pack' },
  { stage: 'packaging', label: 'Packaging' },
];

const EMPTY_COUNTERS: ProgressCounters = {
  discoveredPages: 0,
  completedPages: 0,
  assets: 0,
  elements: 0,
  bytesCaptured: 0,
};

interface CaptureViewProps {
  readonly controller: SitepullController;
}

export function CaptureView({ controller }: CaptureViewProps) {
  const { model, cancelCapture } = controller;
  const session = model.session;
  const progress = session?.progress ?? null;
  const counters = progress?.counters ?? EMPTY_COUNTERS;
  const [now, setNow] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const completedStages = useMemo(() => {
    const completed = new Set<CaptureStage>();
    for (const event of session?.events ?? []) {
      if (event.type === 'progress' && event.state === 'completed') completed.add(event.stage);
    }
    return completed;
  }, [session?.events]);

  const elapsed = captureElapsedMs(session?.startedAt ?? null, progress?.elapsedMs ?? 0, now);
  const determinate = progress?.determinate;

  const cancel = async () => {
    setCancelNotice(null);
    setCancelling(true);
    const accepted = await cancelCapture();
    if (!accepted) {
      setCancelling(false);
      setCancelNotice('The capture is already finishing. Waiting for its final status.');
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(circle_at_50%_-15%,rgba(56,85,160,.09),transparent_42%)]">
      <div className="mx-auto flex min-h-full w-full max-w-[980px] flex-col px-6 py-[clamp(36px,6vh,66px)] sm:px-10">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-blue-300/80">
              <Activity className="size-3.5" />
              Capture in progress
            </div>
            <h1 className="text-[23px] font-semibold tracking-[-0.035em] text-zinc-100">
              {progress?.message ?? 'Starting the capture engine'}
            </h1>
            <p className="mt-1 max-w-[620px] truncate text-[12px] text-zinc-550" aria-live="polite">
              {progress?.currentUrl ?? model.lastRequest?.url ?? 'Preparing capture environment'}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Button
              variant="danger"
              size="sm"
              onClick={() => void cancel()}
              disabled={!session || cancelling}
            >
              {cancelling ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <OctagonX className="size-3.5" />
              )}
              {cancelling ? 'Stopping…' : 'Cancel'}
            </Button>
            {cancelNotice ? (
              <p role="status" className="max-w-[260px] text-right text-[9px] text-amber-300/70">
                {cancelNotice}
              </p>
            ) : null}
          </div>
        </header>

        <div
          role="progressbar"
          aria-label="Capture pipeline progress"
          aria-valuetext={progress?.message ?? 'Starting the capture engine'}
          className="mb-6 overflow-hidden rounded-[3px] bg-white/[0.065]"
        >
          <div className="progress-indeterminate h-1 w-1/3 rounded-full bg-gradient-to-r from-blue-600 to-blue-400" />
        </div>

        <section
          aria-label="Capture metrics"
          className="grid grid-cols-2 gap-px overflow-hidden rounded-[11px] border border-white/[0.07] bg-white/[0.07] sm:grid-cols-5"
        >
          <Metric
            icon={Globe2}
            value={`${formatCount(counters.completedPages)} / ${formatCount(counters.discoveredPages)}`}
            label="Pages"
          />
          <Metric icon={Box} value={formatCount(counters.assets)} label="Assets" />
          <Metric icon={Braces} value={formatCount(counters.elements)} label="Elements" />
          <Metric icon={HardDrive} value={formatBytes(counters.bytesCaptured)} label="Captured" />
          <Metric
            icon={Timer}
            value={formatDuration(elapsed)}
            label="Elapsed"
            className="col-span-2 sm:col-span-1"
          />
        </section>

        {determinate ? (
          <div className="mt-3 flex items-center justify-between px-1 text-[10px] text-zinc-600">
            <span>{progress?.message}</span>
            <span className="tabular-nums">
              {determinate.completed} of {determinate.total}
            </span>
          </div>
        ) : null}

        <div className="mt-8 grid min-h-0 flex-1 gap-6 md:grid-cols-[minmax(240px,0.75fr)_minmax(380px,1.25fr)]">
          <section aria-labelledby="stages-heading">
            <h2
              id="stages-heading"
              className="mb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-650"
            >
              Extraction pipeline
            </h2>
            <ol className="overflow-hidden rounded-[11px] border border-white/[0.07] bg-white/[0.018]">
              {STAGES.map((item) => {
                const completed = completedStages.has(item.stage);
                const active = progress?.stage === item.stage && progress.state !== 'completed';
                const pending = !completed && !active;
                return (
                  <li
                    key={item.stage}
                    className={cn(
                      'flex h-10 items-center gap-2.5 border-b border-white/[0.05] px-3 text-[11px] last:border-b-0',
                      active && 'bg-blue-400/[0.055] text-zinc-200',
                      completed && 'text-zinc-500',
                      pending && 'text-zinc-650',
                    )}
                  >
                    {completed ? (
                      <CircleCheck className="size-3.5 shrink-0 text-emerald-500/70" />
                    ) : active ? (
                      <LoaderCircle className="size-3.5 shrink-0 animate-spin text-blue-400" />
                    ) : (
                      <CircleDashed className="size-3.5 shrink-0" />
                    )}
                    <span>{item.label}</span>
                    <span className="sr-only">
                      {completed ? ' completed' : active ? ' active' : ' pending'}
                    </span>
                    {active ? (
                      <span className="ml-auto text-[9px] font-semibold uppercase tracking-[0.08em] text-blue-400/70">
                        Active
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </section>

          <LiveLogs logs={session?.logs ?? []} />
        </div>
      </div>
    </div>
  );
}

function Metric({
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
    <div className={cn('bg-[#101115] px-3 py-3.5', className)}>
      <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-650">
        <Icon className="size-3" /> {label}
      </div>
      <div className="mt-1.5 text-[15px] font-medium tracking-[-0.025em] text-zinc-200 tabular-nums">
        {value}
      </div>
    </div>
  );
}

function LiveLogs({ logs }: { readonly logs: LogEvent[] }) {
  return (
    <Collapsible.Root defaultOpen className="min-h-0">
      <Collapsible.Trigger className="log-trigger mb-3 flex w-full items-center justify-between rounded px-0.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-650 outline-none hover:text-zinc-400 focus-visible:ring-2 focus-visible:ring-blue-400/50">
        <span className="flex items-center gap-2">
          <FileText className="size-3.5" /> Live logs
          <span className="font-normal tracking-normal text-zinc-700">{logs.length}</span>
        </span>
        <ChevronRight className="log-chevron size-3.5 transition-transform" />
      </Collapsible.Trigger>
      <Collapsible.Panel className="collapsible-panel overflow-hidden">
        <div className="h-[340px] overflow-auto rounded-[11px] border border-white/[0.07] bg-[#08090b] p-2 font-mono text-[10px] leading-5 shadow-inner md:h-full md:min-h-[360px]">
          {logs.length > 0 ? (
            logs.map((log) => (
              <div
                key={`${log.sequence}-${log.timestamp}`}
                className="grid grid-cols-[58px_42px_minmax(0,1fr)] gap-2 rounded px-1.5 hover:bg-white/[0.025]"
              >
                <span className="text-zinc-700">
                  {new Date(log.timestamp).toLocaleTimeString([], {
                    hour12: false,
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
                <span
                  className={cn(
                    'uppercase',
                    log.level === 'error' && 'text-red-400',
                    log.level === 'warn' && 'text-amber-400',
                    log.level === 'info' && 'text-blue-400/80',
                    log.level === 'debug' && 'text-zinc-650',
                  )}
                >
                  {log.level}
                </span>
                <span className="min-w-0 break-words text-zinc-450">{log.message}</span>
              </div>
            ))
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-zinc-700">
              <LoaderCircle className="mb-2 size-4 animate-spin" />
              Waiting for capture events
            </div>
          )}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
