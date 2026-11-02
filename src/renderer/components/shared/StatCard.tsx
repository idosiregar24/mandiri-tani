import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';

export interface StatCardProps {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  /** Small line under the number ("3 nonaktif", "dari iPOS"). */
  hint?: ReactNode;
  to?: string;
  className?: string;
  /** Optional badge next to value (e.g. "▲ 12%", "62 dari 116", "Online") */
  badge?: ReactNode;
  badgeTone?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  /** Optional progress meter 0-100 */
  progress?: number;
  progressColor?: string;
  /** Show subtle info icon beside title */
  showInfo?: boolean;
  infoTooltip?: string;
}

const BADGE_TONES: Record<string, string> = {
  success: 'bg-emerald-50 text-emerald-800 border-border/60',
  warning: 'bg-amber-50 text-amber-800 border-border/60',
  error: 'bg-rose-50 text-rose-800 border-border/60',
  info: 'bg-blue-50 text-blue-800 border-border/60',
  neutral: 'bg-surface-muted text-foreground/80 border-border/60',
};

/** Modern KPI Card */
export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  to,
  className,
  badge,
  badgeTone = 'neutral',
  progress,
  progressColor = 'bg-primary',
  showInfo,
  infoTooltip,
}: StatCardProps) {
  const body = (
    <div className="flex flex-col justify-between h-full">
      {/* Header: Label + Icon + Info */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {Icon && (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-foreground/80 border border-border/50">
              <Icon className="size-3.5" aria-hidden />
            </span>
          )}
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider truncate">
            {label}
          </span>
        </div>
        {showInfo && (
          <span
            className="text-muted-foreground/60 hover:text-foreground transition-colors cursor-help shrink-0"
            title={infoTooltip ?? label}
          >
            <Info className="size-3.5" />
          </span>
        )}
      </div>

      {/* Value & Badge */}
      <div className="my-auto py-1">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <div
            className={cn(
              'font-bold tracking-tight text-foreground tabular-nums leading-none',
              typeof value === 'string' && value.length > 14
                ? 'text-xl'
                : typeof value === 'string' && value.length > 10
                  ? 'text-2xl'
                  : 'text-3xl',
            )}
          >
            {value}
          </div>
          {badge && (
            <span
              className={cn(
                'inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
                BADGE_TONES[badgeTone] ?? BADGE_TONES.neutral,
              )}
            >
              {badge}
            </span>
          )}
        </div>

        {/* Optional Progress Bar */}
        {typeof progress === 'number' && (
          <div className="mt-3 h-1.5 w-full rounded-full bg-surface-muted overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-500', progressColor)}
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        )}
      </div>

      {/* Footer: Hint */}
      {hint && (
        <div className="mt-3 pt-2 border-t border-border/60 text-xs text-muted-foreground font-normal">
          {hint}
        </div>
      )}
    </div>
  );

  const shell = cn(
    'group block rounded-2xl border border-border bg-card p-5 shadow-xs transition-all duration-150 hover:border-border/80 hover:shadow-sm',
    to && 'hover:bg-surface-muted/40 cursor-pointer',
    className,
  );

  return to ? (
    <Link to={to} className={cn(shell, 'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none')}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}
