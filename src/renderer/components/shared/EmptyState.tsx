import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}>
      {Icon && <Icon className="text-muted-foreground size-10" aria-hidden />}
      <p className="text-lg font-semibold">{title}</p>
      {description && <p className="text-muted-foreground max-w-md text-base">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
