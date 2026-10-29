// Building blocks of the "modern minimalis" cashier layout (design-standards §3, owner reference
// 2026-10-29): white card sections, canvas bands, choice chips, summary rows, action links.
import { CheckCircle2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { keyName } from './dialogs';

/** One section of the main card: small bold title, optional hint on the right. */
export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="px-6 py-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Thin canvas-coloured band between sections. */
export function Band() {
  return <div className="bg-canvas h-2 shrink-0" aria-hidden />;
}

/** Choice chip: the selected one is filled with the primary colour, the others are outlined. */
export function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'inline-flex h-11 items-center gap-2 rounded-md border px-4 text-base transition-colors',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        selected
          ? 'border-primary bg-primary text-primary-foreground font-semibold shadow-xs'
          : 'bg-background hover:border-primary/60',
      )}
    >
      {children}
    </button>
  );
}

export function Pill({ children, tone = 'success' }: { children: ReactNode; tone?: 'success' | 'info' }) {
  return (
    <span
      className={cn(
        'mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-medium',
        tone === 'success' ? 'bg-success/10 text-success-ink' : 'bg-info/10 text-info-ink',
      )}
    >
      <CheckCircle2 className="size-3.5" /> {children}
    </span>
  );
}

export function ActionLink({ label, combo, onClick }: { label: string; combo: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-primary hover:text-tani-green-dark inline-flex shrink-0 items-center gap-1.5 text-sm font-medium"
    >
      {label} <Kbd combo={combo} />
    </button>
  );
}

/** Summary block: small grey label, content below, an action link on the right ("Ganti"). */
export function SummaryItem({
  label,
  action,
  combo,
  onAction,
  children,
}: {
  label: string;
  action: string;
  combo: string;
  onAction: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-muted-foreground mb-1 text-sm">{label}</p>
        {children}
      </div>
      <ActionLink label={action} combo={combo} onClick={onAction} />
    </div>
  );
}

export function Row({
  label,
  value,
  action,
  combo,
  onAction,
  tone,
}: {
  label: string;
  value: string;
  action?: string;
  combo?: string;
  onAction?: () => void;
  tone?: 'error';
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-base">
      <span className="text-muted-foreground flex items-center gap-2">
        {label}
        {action && combo && onAction && <ActionLink label={action} combo={combo} onClick={onAction} />}
      </span>
      <span className={cn('font-medium tabular-nums', tone === 'error' && 'text-error-ink')}>{value}</span>
    </div>
  );
}

export function Kbd({ combo, light }: { combo: string; light?: boolean }) {
  return (
    <kbd
      className={cn(
        'rounded border px-1.5 font-mono text-xs font-normal',
        light ? 'border-white/40' : 'bg-surface-muted text-muted-foreground',
      )}
    >
      {keyName(combo)}
    </kbd>
  );
}
