import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type StatusTone = 'success' | 'neutral' | 'warning' | 'error' | 'info';

const TONES: Record<StatusTone, { pill: string }> = {
  success: { pill: 'border-border/60 bg-emerald-50 text-emerald-800' },
  neutral: { pill: 'border-border/60 bg-surface-muted text-muted-foreground' },
  warning: { pill: 'border-border/60 bg-amber-50 text-amber-800' },
  error: { pill: 'border-border/60 bg-rose-50 text-rose-800' },
  info: { pill: 'border-border/60 bg-blue-50 text-blue-800' },
};

interface StatusPillProps {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
  /** @deprecated Dots removed per design revision */
  pulse?: boolean;
}

/** Clean, modern status pill without dots or colored borders */
export function StatusPill({ tone, children, className }: StatusPillProps) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        t.pill,
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The common "Aktif / Nonaktif" pair for master data. */
export function ActivePill({ active }: { active: boolean }) {
  return <StatusPill tone={active ? 'success' : 'neutral'}>{active ? 'Aktif' : 'Nonaktif'}</StatusPill>;
}
