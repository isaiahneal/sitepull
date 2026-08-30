import { ImageOff } from 'lucide-react';
import type { ImgHTMLAttributes, ReactNode } from 'react';
import { useState } from 'react';

import { cn } from '../../lib/utils.js';

export function WorkspacePanel({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section
      className={cn('rounded-[11px] border border-white/[0.07] bg-white/[0.018]', className)}
    >
      {children}
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  aside,
}: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly aside?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        {eyebrow ? (
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.13em] text-zinc-650">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="text-[13px] font-semibold tracking-[-0.015em] text-zinc-250">{title}</h2>
      </div>
      {aside}
    </div>
  );
}

interface ArtifactImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  readonly frameClassName?: string;
  readonly fallbackLabel?: string;
  readonly scrollable?: boolean;
}

export function ArtifactImage({
  className,
  frameClassName,
  fallbackLabel = 'Preview unavailable',
  scrollable = false,
  alt,
  src,
  ...props
}: ArtifactImageProps) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const failed = src !== undefined && failedSource === src;
  return (
    <div
      className={cn(
        'relative bg-[#0d0e11]',
        scrollable ? 'overflow-auto' : 'overflow-hidden',
        frameClassName,
      )}
    >
      {failed ? (
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-2 text-[10px] text-zinc-650">
            <ImageOff className="size-4" />
            {fallbackLabel}
          </div>
        </div>
      ) : (
        <img
          draggable={false}
          alt={alt}
          src={src}
          className={cn('block h-full w-full object-contain', className)}
          onError={() => setFailedSource(src ?? '')}
          {...props}
        />
      )}
    </div>
  );
}

export function EmptyPanel({
  icon: Icon,
  title,
  detail,
}: {
  readonly icon: typeof ImageOff;
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <div className="grid min-h-[240px] place-items-center p-8 text-center">
      <div>
        <Icon className="mx-auto mb-3 size-5 text-zinc-700" />
        <p className="text-[12px] font-medium text-zinc-400">{title}</p>
        <p className="mt-1 max-w-[360px] text-[11px] leading-4 text-zinc-650">{detail}</p>
      </div>
    </div>
  );
}

export function ConfidenceBar({ confidence }: { readonly confidence: number }) {
  const percentage = Math.round(Math.min(1, Math.max(0, confidence)) * 100);
  return (
    <div
      role="meter"
      aria-label="Inference confidence"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percentage}
      className="flex items-center gap-2"
    >
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-blue-400/80" style={{ width: `${percentage}%` }} />
      </div>
      <span className="w-8 text-right text-[9px] tabular-nums text-zinc-600">{percentage}%</span>
    </div>
  );
}
