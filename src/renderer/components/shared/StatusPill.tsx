import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type StatusTone = 'success' | 'neutral' | 'warning' | 'error' | 'info';

const TONES: Record<StatusTone, { pill: string; dot: string }> = {
  success: { pill: 'border-success/25 bg-success/10 text-success-ink', dot: 'bg-success' },
  neutral: { pill: 'border-border bg-surface-muted text-muted-foreground', dot: 'bg-muted-foreground/60' },
  warning: { pill: 'border-warning/40 bg-warning/10 text-warning-ink', dot: 'bg-warning' },
  error: { pill: 'border-error/25 bg-error/10 text-error-ink', dot: 'bg-error' },
  info: { pill: 'border-info/25 bg-info/10 text-info-ink', dot: 'bg-info' },
};

interface StatusPillProps {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}

/** A status as a small pill with a coloured dot (e.g. "● Aktif"). Colour always comes with text. */
export function StatusPill({ tone, children, className }: StatusPillProps) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-medium whitespace-nowrap',
        t.pill,
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', t.dot)} aria-hidden />
      {children}
    </span>
  );
}

/** The common "Aktif / Nonaktif" pair for master data. */
export function ActivePill({ active }: { active: boolean }) {
  return <StatusPill tone={active ? 'success' : 'neutral'}>{active ? 'Aktif' : 'Nonaktif'}</StatusPill>;
}
