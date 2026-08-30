import type { InputHTMLAttributes } from 'react';

import { cn } from '../../lib/utils.js';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'no-drag h-9 w-full rounded-[9px] border border-white/[0.09] bg-black/20 px-3 text-[13px] text-zinc-100 outline-none transition-[border-color,box-shadow,background-color] placeholder:text-zinc-600 hover:border-white/[0.13] focus:border-blue-400/50 focus:bg-black/30 focus:ring-2 focus:ring-blue-500/15 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
