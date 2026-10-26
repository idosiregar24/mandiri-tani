import { cn } from '@/lib/utils';

interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string; count?: number }[];
  /** Accessible name of the group, e.g. "Status". */
  label: string;
  className?: string;
}

/** A small set of mutually exclusive filters ("Aktif · Semua"), keyboard operable with arrow keys. */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: SegmentedControlProps<T>) {
  const move = (dir: 1 | -1) => {
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + dir + options.length) % options.length];
    if (next) onChange(next.value);
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('bg-surface-muted inline-flex h-11 items-center gap-1 rounded-lg border p-1', className)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') move(1);
        if (e.key === 'ArrowLeft') move(-1);
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              'focus-visible:ring-ring h-full rounded-md px-4 text-base transition-colors focus-visible:ring-2 focus-visible:outline-none',
              active
                ? 'bg-background text-foreground font-medium shadow-xs ring-1 ring-black/5'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span className="text-muted-foreground ml-1.5 text-sm tabular-nums">{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
