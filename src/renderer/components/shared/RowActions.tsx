import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface RowAction {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** Dangerous actions sit last, after a separator, in red (design-standards §0.2). */
  danger?: boolean;
}

interface RowActionsProps {
  actions: RowAction[];
  /** For screen readers: "Aksi untuk Pupuk Urea". */
  label: string;
}

/** The "⋯" menu at the end of a table row. Clicks do not reach the row's own onClick. */
export function RowActions({ actions, label }: RowActionsProps) {
  const safe = actions.filter((a) => !a.danger);
  const danger = actions.filter((a) => a.danger);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-10"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48" onClick={(e) => e.stopPropagation()}>
        {safe.map((a) => (
          <DropdownMenuItem key={a.label} className="h-10 text-base" onSelect={a.onSelect}>
            <a.icon className="size-4" /> {a.label}
          </DropdownMenuItem>
        ))}
        {danger.length > 0 && safe.length > 0 && <DropdownMenuSeparator />}
        {danger.map((a) => (
          <DropdownMenuItem
            key={a.label}
            className="text-error-ink focus:text-error-ink h-10 text-base"
            onSelect={a.onSelect}
          >
            <a.icon className="size-4" /> {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
