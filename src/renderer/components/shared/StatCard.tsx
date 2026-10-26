import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  /** Small line under the number ("3 nonaktif", "dari iPOS"). */
  hint?: ReactNode;
  to?: string;
  className?: string;
}

/** A KPI number on a card (design-standards §2). */
export function StatCard({ label, value, icon: Icon, hint, to, className }: StatCardProps) {
  const body = (
    <>
      <div className="bg-surface-muted rounded-lg border p-4">
        <div className="text-muted-foreground flex items-center gap-2 text-base">
          <span className="bg-background flex size-8 items-center justify-center rounded-md border shadow-xs">
            <Icon className="text-foreground size-4" aria-hidden />
          </span>
          {label}
        </div>
        {/* Long numbers (rupiah in billions) step down a size instead of wrapping. */}
        <div
          className={cn(
            'mt-3 font-semibold whitespace-nowrap tabular-nums',
            typeof value === 'string' && value.length > 12 ? 'text-2xl' : 'text-3xl',
          )}
        >
          {value}
        </div>
      </div>
      {hint && <div className="text-muted-foreground px-2 pt-2 pb-0.5 text-sm">{hint}</div>}
    </>
  );
  const shell = cn(
    'bg-background block rounded-xl border p-1.5 transition-colors',
    to && 'hover:border-foreground/20',
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
