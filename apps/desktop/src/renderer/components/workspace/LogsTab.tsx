import { Collapsible } from '@base-ui/react/collapsible';
import type {
  CaptureStage,
  FilePreviewResult,
  IpcResult,
  LogEvent,
  LogLevel,
} from '@sitepull/contracts';
import { ChevronRight, FileWarning, LoaderCircle, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { cn, readableStage } from '../../lib/utils.js';
import { Input } from '../ui/input.js';
import { EmptyPanel } from './shared.js';

interface StructuredLog {
  readonly id: string;
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly stage: CaptureStage | null;
  readonly message: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

interface LogsTabProps {
  readonly liveLogs: LogEvent[];
  readonly readCaptureFile: (relativePath: string) => Promise<IpcResult<FilePreviewResult> | null>;
}

const LEVELS: ReadonlyArray<'all' | LogLevel> = ['all', 'info', 'warn', 'error', 'debug'];

export function LogsTab({ liveLogs, readCaptureFile }: LogsTabProps) {
  const [persisted, setPersisted] = useState<StructuredLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [level, setLevel] = useState<'all' | LogLevel>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let current = true;
    void readCaptureFile('logs/sitepull.jsonl')
      .then((response) => {
        if (!current) return;
        setLoading(false);
        if (!response) {
          setLoadError('The structured log file is unavailable.');
        } else if (!response.ok) {
          setLoadError(response.error.message);
        } else {
          setPersisted(parseJsonLines(response.data.content));
          setTruncated(response.data.truncated);
        }
      })
      .catch((reason: unknown) => {
        if (!current) return;
        setLoading(false);
        setLoadError(
          reason instanceof Error ? reason.message : 'The structured logs could not be loaded.',
        );
      });
    return () => {
      current = false;
    };
  }, [readCaptureFile]);

  const logs: StructuredLog[] = useMemo(
    () =>
      persisted.length > 0
        ? persisted
        : liveLogs.map((log) => ({
            id: `${log.sequence}-${log.timestamp}`,
            timestamp: log.timestamp,
            level: log.level,
            stage: log.stage,
            message: log.message,
            ...(log.context ? { context: log.context } : {}),
          })),
    [liveLogs, persisted],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return logs.filter((log) => {
      if (level !== 'all' && log.level !== level) return false;
      return (
        !needle ||
        `${log.message} ${log.stage ?? ''} ${JSON.stringify(log.context ?? {})}`
          .toLowerCase()
          .includes(needle)
      );
    });
  }, [level, logs, query]);
  const showLoading = logs.length === 0 && loading;

  return (
    <div className="overflow-hidden rounded-[11px] border border-white/[0.07] bg-[#0b0c0f]">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] bg-[#101115] p-2.5">
        <div className="flex gap-1">
          {LEVELS.map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => setLevel(entry)}
              aria-pressed={level === entry}
              className={cn(
                'rounded-[7px] px-2.5 py-1.5 text-[9px] capitalize outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-400/50',
                level === entry
                  ? 'bg-white/[0.09] text-zinc-200'
                  : 'text-zinc-650 hover:bg-white/[0.035] hover:text-zinc-300',
              )}
            >
              {entry}
              <span className="ml-1 text-zinc-750">
                {entry === 'all' ? logs.length : logs.filter((log) => log.level === entry).length}
              </span>
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-[230px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-650" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search messages"
            aria-label="Search log messages"
            className="h-8 pl-8 text-[11px]"
          />
        </div>
      </div>

      {truncated ? (
        <div
          role="status"
          className="border-b border-amber-400/10 bg-amber-400/[0.05] px-3 py-2 text-[9px] text-amber-300/70"
        >
          Showing the first 1 MB of the structured log. Any partial final JSONL record is omitted.
        </div>
      ) : null}

      {showLoading ? (
        <div className="grid min-h-[420px] place-items-center text-[10px] text-zinc-650">
          <div className="text-center">
            <LoaderCircle className="mx-auto mb-2 size-4 animate-spin" />
            Loading structured logs
          </div>
        </div>
      ) : filtered.length > 0 ? (
        <div className="max-h-[calc(100vh-260px)] min-h-[420px] overflow-auto font-mono">
          {filtered.map((log) => (
            <LogRow key={log.id} log={log} />
          ))}
        </div>
      ) : (
        <EmptyPanel
          icon={FileWarning}
          title={loadError ?? 'No matching log entries'}
          detail={
            loadError
              ? 'The capture project can still be inspected through its manifest and generated files.'
              : 'Adjust the severity filter or search text.'
          }
        />
      )}
    </div>
  );
}

function LogRow({ log }: { readonly log: StructuredLog }) {
  const hasContext = log.context && Object.keys(log.context).length > 0;
  const content = (
    <div className="grid min-h-9 grid-cols-[66px_42px_120px_minmax(0,1fr)] items-start gap-2 px-3 py-2 text-[9px] max-md:grid-cols-[60px_40px_minmax(0,1fr)]">
      <span className="tabular-nums text-zinc-750">
        {new Date(log.timestamp).toLocaleTimeString([], {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}
      </span>
      <span className={cn('uppercase', levelColor(log.level))}>{log.level}</span>
      <span className="truncate text-zinc-650 max-md:hidden" title={log.stage ?? undefined}>
        {log.stage ? readableStage(log.stage) : 'General'}
      </span>
      <span className="min-w-0 break-words text-zinc-400">{log.message}</span>
    </div>
  );

  if (!hasContext)
    return <div className="border-b border-white/[0.045] hover:bg-white/[0.018]">{content}</div>;
  return (
    <Collapsible.Root className="border-b border-white/[0.045]">
      <Collapsible.Trigger className="log-row-trigger flex w-full items-start text-left outline-none hover:bg-white/[0.018] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400/50">
        <ChevronRight className="log-row-chevron ml-2 mt-3 size-3 shrink-0 text-zinc-700 transition-transform" />
        <div className="min-w-0 flex-1">{content}</div>
      </Collapsible.Trigger>
      <Collapsible.Panel className="collapsible-panel overflow-hidden">
        <pre className="mx-3 mb-2 ml-[86px] max-h-[180px] overflow-auto rounded-[7px] border border-white/[0.06] bg-black/20 p-2.5 text-[8px] leading-4 text-zinc-550">
          {JSON.stringify(log.context, null, 2)}
        </pre>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

function levelColor(level: LogLevel): string {
  if (level === 'error') return 'text-red-400';
  if (level === 'warn') return 'text-amber-400';
  if (level === 'info') return 'text-blue-400/80';
  return 'text-zinc-650';
}

function parseJsonLines(content: string): StructuredLog[] {
  const logs: StructuredLog[] = [];
  for (const [index, line] of content.split('\n').slice(0, 10_000).entries()) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (!isLogRecord(value)) continue;
      logs.push({
        id: `persisted-${index}-${value.timestamp}`,
        timestamp: value.timestamp,
        level: value.level,
        stage: isStage(value.stage) ? value.stage : null,
        message: value.message,
        ...(isRecord(value.context) ? { context: value.context } : {}),
      });
    } catch {
      // Ignore individually malformed lines; later structured records remain inspectable.
    }
  }
  return logs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLogRecord(value: unknown): value is {
  timestamp: string;
  level: LogLevel;
  stage?: unknown;
  message: string;
  context?: unknown;
} {
  if (!isRecord(value)) return false;
  return (
    typeof value.timestamp === 'string' &&
    typeof value.message === 'string' &&
    ['debug', 'info', 'warn', 'error'].includes(String(value.level))
  );
}

function isStage(value: unknown): value is CaptureStage {
  return (
    typeof value === 'string' &&
    [
      'normalizing-url',
      'launching-browser',
      'rendering',
      'discovering-routes',
      'crawling-pages',
      'capturing-assets',
      'extracting-styles',
      'analyzing-design-system',
      'building-ai-pack',
      'packaging',
    ].includes(value)
  );
}
