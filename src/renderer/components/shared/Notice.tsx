import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'info' | 'success' | 'warning' | 'error';

const TONES: Record<Tone, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: 'border-info/30 bg-info/10 text-info-ink' },
  success: { icon: CheckCircle2, className: 'border-success/30 bg-success/10 text-success-ink' },
  warning: { icon: AlertTriangle, className: 'border-warning/40 bg-warning/10 text-warning-ink' },
  error: { icon: XCircle, className: 'border-error/30 bg-error/10 text-error-ink' },
};

interface NoticeProps {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  className?: string;
}

/** A message that stays on screen until its cause is gone — never a toast that disappears (design-standards §3). */
export function Notice({ tone = 'info', title, children, className }: NoticeProps) {
  const { icon: Icon, className: toneClass } = TONES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-lg border p-4 text-base', toneClass, className)}
    >
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}
