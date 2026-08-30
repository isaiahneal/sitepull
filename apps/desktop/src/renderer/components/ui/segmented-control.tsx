import { cn } from '../../lib/utils.js';

export interface Segment<T extends string> {
  readonly value: T;
  readonly label: string;
}

interface SegmentedControlProps<T extends string> {
  readonly value: T;
  readonly segments: readonly Segment<T>[];
  readonly onChange: (value: T) => void;
  readonly label: string;
  readonly className?: string;
}

export function SegmentedControl<T extends string>({
  value,
  segments,
  onChange,
  label,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex rounded-lg border border-white/[0.08] bg-black/25 p-0.5',
        className,
      )}
    >
      {segments.map((segment) => (
        <button
          key={segment.value}
          type="button"
          aria-pressed={segment.value === value}
          onClick={() => onChange(segment.value)}
          className={cn(
            'rounded-[6px] px-2.5 py-1 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-400/50',
            segment.value === value
              ? 'bg-white/[0.1] text-zinc-100 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-300',
          )}
        >
          {segment.label}
        </button>
      ))}
    </div>
  );
}
