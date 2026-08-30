import { Box, CircleCheck, Command, House as Home, Keyboard } from 'lucide-react';
import type { ReactNode } from 'react';

import type { AppScreen } from '../types.js';
import { cn } from '../lib/utils.js';

interface AppChromeProps {
  readonly screen: AppScreen;
  readonly hostname: string | undefined;
  readonly onHome: () => void;
  readonly children: ReactNode;
}

export function AppChrome({ screen, hostname, onHome, children }: AppChromeProps) {
  const isMacOs = navigator.userAgent.includes('Macintosh');
  return (
    <div className="relative flex h-screen min-h-[560px] flex-col overflow-hidden bg-[#090a0d] text-zinc-100">
      <header
        className={cn(
          'app-drag-region relative z-40 flex h-[52px] shrink-0 items-end border-b border-white/[0.065] bg-[#0b0c0f]/95 px-3 pb-2.5 backdrop-blur-xl',
          isMacOs ? 'pl-[82px]' : 'pl-3',
        )}
      >
        <button
          type="button"
          onClick={onHome}
          disabled={screen === 'capturing'}
          className="no-drag group flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 disabled:pointer-events-none"
          aria-label={screen === 'capturing' ? 'Sitepull' : 'Sitepull home'}
        >
          <span className="grid size-[22px] place-items-center rounded-[6px] border border-white/10 bg-gradient-to-b from-white/[0.11] to-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,.12),0_2px_8px_rgba(0,0,0,.3)]">
            <Box aria-hidden="true" className="size-3.5 text-blue-300" strokeWidth={1.75} />
          </span>
          <span className="text-[13px] font-semibold tracking-[-0.02em] text-zinc-200 transition-colors group-hover:text-white">
            Sitepull
          </span>
        </button>

        {hostname && screen === 'results' ? (
          <div className="ml-2 flex min-w-0 items-center gap-2 text-[12px] text-zinc-600">
            <span>/</span>
            <span className="max-w-[32vw] truncate text-zinc-400">{hostname}</span>
          </div>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          {screen === 'capturing' ? (
            <div className="flex items-center gap-2 rounded-full border border-blue-400/15 bg-blue-400/[0.07] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-blue-300">
              <span className="capture-pulse size-1.5 rounded-full bg-blue-400" />
              Live capture
            </div>
          ) : null}
          {screen === 'results' ? (
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-400/80">
              <CircleCheck className="size-3.5" />
              Capture complete
            </div>
          ) : null}
          {screen === 'empty' ? (
            <div
              className="no-drag hidden items-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.035] px-2 py-1 text-[10px] text-zinc-500 sm:flex"
              title="Start capture shortcut"
            >
              {isMacOs ? <Command className="size-3" /> : <Keyboard className="size-3" />}
              {isMacOs ? 'Enter' : 'Ctrl + Enter'}
            </div>
          ) : null}
          {screen === 'results' || screen === 'error' ? (
            <button
              type="button"
              onClick={onHome}
              className="no-drag grid size-7 place-items-center rounded-md text-zinc-500 outline-none transition-colors hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-blue-400/50"
              aria-label="New capture"
              title="New capture"
            >
              <Home className="size-3.5" />
            </button>
          ) : null}
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
