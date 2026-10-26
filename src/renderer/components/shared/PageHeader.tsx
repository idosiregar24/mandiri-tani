import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  /** Buttons on the right; at most one primary button per screen (design-standards §0). */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, icon: Icon, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="flex items-start gap-3">
        {Icon && <Icon className="text-tani-green-dark mt-1 size-7 shrink-0" aria-hidden />}
        <div>
          <h1 className="text-tani-green-dark text-2xl font-bold">{title}</h1>
          {description && <p className="text-muted-foreground mt-1 text-base">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
