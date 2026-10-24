// Shows the boot screen until the main process reports READY (PRD §3.2, sprint-1 B4).
// Outside Electron (plain browser / later mobile) there is no lifecycle — render directly.
import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, FolderOpen, Loader2, RotateCcw } from 'lucide-react';
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
  return <BootScreen status={status} onRetry={() => void bridge.retryBoot()} onOpenLogs={() => void bridge.openLogFolder()} />;
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
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-xl text-center">
        <h1 className="text-tani-green-dark text-4xl font-bold">Mandiri Tani POS</h1>

        {!fatal && (
          <div className="mt-10 flex flex-col items-center gap-4" role="status" aria-live="polite">
            <Loader2 className="text-tani-green size-10 animate-spin" aria-hidden />
            <p className="text-xl">{status?.message ?? 'Menyiapkan aplikasi…'}</p>
          </div>
        )}

        {fatal && (
          <div className="mt-10 rounded-xl border-2 border-error bg-white p-6 text-left" role="alert">
            <div className="flex items-center gap-3">
              <AlertTriangle className="text-error-ink size-7 shrink-0" aria-hidden />
              <p className="text-error-ink text-xl font-semibold">{status.message}</p>
            </div>
            {status.detail && <p className="mt-4 text-lg whitespace-pre-line">{firstLine(status.detail)}</p>}
            <p className="text-muted-foreground mt-4">
              Coba lagi dulu. Bila tetap gagal, buka folder log dan kirim isinya ke admin.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button size="lg" className="h-12 px-6 text-base" onClick={onRetry}>
                <RotateCcw /> Coba lagi
              </Button>
              <Button size="lg" variant="outline" className="h-12 px-6 text-base" onClick={onOpenLogs}>
                <FolderOpen /> Buka folder log
              </Button>
            </div>
            {status.detail && status.detail.includes('\n') && (
              <details className="text-muted-foreground mt-6 text-sm">
                <summary className="cursor-pointer">Detail teknis</summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap">{status.detail}</pre>
              </details>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function firstLine(text: string): string {
  return text.split('\n')[0] ?? text;
}
