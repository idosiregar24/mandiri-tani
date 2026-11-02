// Shows the boot screen until the main process reports READY (PRD §3.2, sprint-1 B4).
// Outside Electron (plain browser / later mobile) there is no lifecycle — render directly.
import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, FolderOpen, Leaf, Loader2, Mail, Phone, RotateCcw } from 'lucide-react';
import type { LifecycleStatus } from '@shared/lifecycle';
import { Button } from '@/components/ui/button';

export function BootGate({ children }: { children: ReactNode }) {
  const bridge = window.pos;
  const [status, setStatus] = useState<LifecycleStatus | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    void bridge.getLifecycle().then((s) => active && setStatus(s));
    const unsubscribe = bridge.onLifecycle((s) => setStatus(s));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);

  if (!bridge) return <>{children}</>;
  // Packaged app: the boot screen is loaded from disk; main reloads it from the server once READY.
  const waitingForReload = window.location.protocol === 'file:';
  if (status?.state === 'READY' && !waitingForReload) return <>{children}</>;
  return (
    <BootScreen
      status={status}
      onRetry={() => void bridge.retryBoot()}
      onOpenLogs={() => void bridge.openLogFolder()}
    />
  );
}

function BootScreen({
  status,
  onRetry,
  onOpenLogs,
}: {
  status: LifecycleStatus | null;
  onRetry: () => void;
  onOpenLogs: () => void;
}) {
  const fatal = status?.state === 'FATAL';
  return (
    <main className="bg-canvas flex min-h-screen flex-col items-center justify-between p-6 md:p-10 select-none">
      <div /> {/* Spacer for vertical balance */}

      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-xs">
          <Leaf className="size-7" aria-hidden />
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">Mandiri Tani POS</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sistem Kasir & Operasional Toko Pertanian</p>

        {!fatal && (
          <div className="mt-8 rounded-xl border border-border/70 bg-card p-6 shadow-xs" role="status" aria-live="polite">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="text-primary size-7 animate-spin" aria-hidden />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">{status?.message ?? 'Menyiapkan aplikasi…'}</p>
                <p className="text-xs text-muted-foreground">Memulai database dan server lokal…</p>
              </div>
            </div>
          </div>
        )}

        {fatal && (
          <div className="mt-8 rounded-xl border border-destructive/40 bg-card p-6 text-left shadow-xs" role="alert">
            <div className="flex items-center gap-3">
              <AlertTriangle className="text-destructive size-6 shrink-0" aria-hidden />
              <p className="text-destructive text-base font-semibold">{status.message}</p>
            </div>
            {status.detail && <p className="mt-3 text-sm text-foreground/80 whitespace-pre-line">{firstLine(status.detail)}</p>}
            <p className="mt-3 text-xs text-muted-foreground">
              Coba lagi dulu. Bila tetap gagal, buka folder log dan hubungi pengembang aplikasi.
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <Button size="sm" className="h-9 px-4 text-xs font-medium" onClick={onRetry}>
                <RotateCcw className="mr-1.5 size-3.5" /> Coba lagi
              </Button>
              <Button size="sm" variant="outline" className="h-9 px-4 text-xs font-medium" onClick={onOpenLogs}>
                <FolderOpen className="mr-1.5 size-3.5" /> Buka folder log
              </Button>
            </div>
            {status.detail && status.detail.includes('\n') && (
              <details className="mt-4 text-xs text-muted-foreground">
                <summary className="cursor-pointer font-medium hover:text-foreground">Detail teknis</summary>
                <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted/60 p-3 font-mono text-[11px] whitespace-pre-wrap">{status.detail}</pre>
              </details>
            )}
          </div>
        )}
      </div>

      {/* Developer credit footer */}
      <footer className="mt-8 w-full max-w-md border-t border-border/60 pt-4 text-center">
        <div className="inline-flex flex-col items-center gap-1.5 text-xs text-muted-foreground">
          <p className="font-medium text-foreground/80">
            Dikembangkan oleh <span className="font-semibold text-foreground">Ido Refael Siregar</span>
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-mono">
              <Phone className="size-3 text-muted-foreground/70" /> 081363554262
            </span>
            <span className="text-border hidden sm:inline">•</span>
            <span className="inline-flex items-center gap-1 font-mono">
              <Mail className="size-3 text-muted-foreground/70" /> idosiregar2006@gmail.com
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
}

function firstLine(text: string): string {
  return text.split('\n')[0] ?? text;
}
