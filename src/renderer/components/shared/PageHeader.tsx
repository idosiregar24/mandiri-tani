import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Number shown next to the title ("Pelanggan 1.238"). */
  count?: string;
  /** Buttons on the right; at most one primary button per screen (design-standards §0). */
  actions?: ReactNode;
  className?: string;
}

/** Clean, crisp Page Header */
export function PageHeader({
  title,
  description,
  count,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-4 pb-1', className)}>
      <div>
        <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-foreground leading-tight">
          {title}
          {count && (
            <span className="text-muted-foreground bg-surface-muted border border-border rounded-full px-2.5 py-0.5 text-xs font-mono font-medium tabular-nums">
              {count}
            </span>
          )}
        </h1>
        {description && (
          <div className="text-muted-foreground mt-1 text-xs sm:text-sm font-normal">
            {description}
          </div>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </header>
  );
}
