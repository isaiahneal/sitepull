import { cva } from 'class-variance-authority';

export const buttonVariants = cva(
  'no-drag inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-[9px] border text-[13px] font-medium tracking-[-0.01em] transition-[background-color,border-color,color,box-shadow,transform] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0b0c0f] disabled:pointer-events-none disabled:opacity-45 active:translate-y-px',
  {
    variants: {
      variant: {
        primary:
          'border-blue-300/20 bg-blue-500 text-white shadow-[0_1px_2px_rgba(0,0,0,.35),inset_0_1px_0_rgba(255,255,255,.15)] hover:bg-blue-400',
        secondary:
          'border-white/[0.09] bg-white/[0.055] text-zinc-200 shadow-[0_1px_2px_rgba(0,0,0,.25)] hover:border-white/[0.15] hover:bg-white/[0.085] hover:text-white',
        ghost:
          'border-transparent bg-transparent text-zinc-400 hover:bg-white/[0.055] hover:text-zinc-100',
        danger:
          'border-red-400/20 bg-red-500/10 text-red-300 hover:border-red-400/30 hover:bg-red-500/15',
      },
      size: {
        sm: 'h-8 px-2.5',
        md: 'h-9 px-3.5',
        lg: 'h-11 px-4 text-[14px]',
        icon: 'size-8 p-0',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  },
);
