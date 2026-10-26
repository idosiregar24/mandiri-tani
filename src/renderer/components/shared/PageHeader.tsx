import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Number shown next to the title ("Pelanggan 1.238"). */
  count?: string;
  /** Buttons on the right; at most one primary button per screen (design-standards §0). */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, count, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-4', className)}>
      <div>
        <h1 className="flex items-center gap-3 text-[1.5rem] leading-tight font-semibold tracking-tight">
          {title}
          {count && (
            <span className="text-muted-foreground bg-surface-muted rounded-md border px-2 py-0.5 text-base font-medium tabular-nums">
              {count}
            </span>
          )}
        </h1>
        {description && <p className="text-muted-foreground mt-1.5 text-base">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
