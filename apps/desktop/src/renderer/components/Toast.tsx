import { CircleAlert, CircleCheck, X } from 'lucide-react';

import { cn } from '../lib/utils.js';

export interface ToastState {
  readonly tone: 'success' | 'error';
  readonly message: string;
}

interface ToastProps {
  readonly toast: ToastState | null;
  readonly onDismiss: () => void;
}

export function Toast({ toast, onDismiss }: ToastProps) {
  if (!toast) return null;
  const Icon = toast.tone === 'success' ? CircleCheck : CircleAlert;
  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'fixed bottom-5 left-1/2 z-[100] flex max-w-[min(440px,calc(100vw-32px))] -translate-x-1/2 items-center gap-2 rounded-[10px] border bg-[#17181d]/95 px-3 py-2.5 text-[12px] shadow-[0_16px_48px_rgba(0,0,0,.45)] backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2',
        toast.tone === 'success'
          ? 'border-emerald-400/20 text-emerald-100'
          : 'border-red-400/20 text-red-100',
      )}
    >
      <Icon
        className={cn(
          'size-4 shrink-0',
          toast.tone === 'success' ? 'text-emerald-400' : 'text-red-400',
        )}
      />
      <span className="min-w-0 flex-1">{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="rounded p-0.5 text-zinc-500 outline-none hover:bg-white/10 hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-blue-400/50"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
