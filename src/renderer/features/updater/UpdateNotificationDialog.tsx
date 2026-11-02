import { CheckCircle2, Download, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useUpdater } from '@/hooks/useUpdater';

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function UpdateNotificationDialog() {
  const { status, hasUpdate, isDownloading, isDownloaded, isDismissed, downloadUpdate, installUpdate, dismiss } =
    useUpdater();

  if (!hasUpdate || isDismissed) {
    return null;
  }

  const { availableVersion, currentVersion, releaseNotes, progress } = status;

  return (
    <Dialog open={true} onOpenChange={(open) => !open && dismiss()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg">
              {isDownloaded ? (
                <CheckCircle2 className="size-5 text-emerald-600" />
              ) : isDownloading ? (
                <Loader2 className="size-5 animate-spin text-primary" />
              ) : (
                <Sparkles className="size-5" />
              )}
            </div>
            <div>
              <DialogTitle className="text-lg">
                {isDownloaded
                  ? 'Pembaruan Siap Dipasang'
                  : isDownloading
                    ? 'Mengunduh Pembaruan...'
                    : 'Pembaruan Aplikasi Tersedia'}
              </DialogTitle>
              <DialogDescription className="text-sm">
                Versi saat ini: <span className="font-mono font-medium">v{currentVersion}</span> &rarr; Versi baru:{' '}
                <span className="font-mono font-semibold text-foreground">v{availableVersion}</span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {isDownloading ? (
          <div className="space-y-4 py-3">
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-medium">
                <span>Mengunduh installer dari GitHub Releases</span>
                <span>{progress?.percent ?? 0}%</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-muted">
                <div
                  className="bg-primary h-full transition-all duration-300"
                  style={{ width: `${progress?.percent ?? 0}%` }}
                />
              </div>
              <div className="flex justify-between text-muted-foreground text-xs">
                <span>{formatBytes(progress?.bytesPerSecond)}/dtk</span>
                <span>
                  {formatBytes(progress?.transferred)} / {formatBytes(progress?.total)}
                </span>
              </div>
            </div>
            <p className="text-muted-foreground bg-surface-muted/60 rounded-lg p-3 text-xs leading-relaxed">
              💡 Unduhan berjalan di latar belakang. Anda tetap dapat melayani transaksi kasir seperti biasa.
            </p>
          </div>
        ) : isDownloaded ? (
          <div className="space-y-3 py-2">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3.5 text-xs text-emerald-900 leading-relaxed">
              <strong>Pembaruan telah siap!</strong> Saat Anda menekan tombol di bawah, aplikasi kasir akan dimatikan
              sebentar. Database PostgreSQL akan diamankan dan ditutup dengan rapi sebelum sistem memasang versi baru.
            </div>
            {releaseNotes && (
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs font-semibold uppercase">Catatan Rilis:</p>
                <div className="max-h-36 overflow-y-auto rounded-lg border bg-surface-muted/50 p-2.5 font-mono text-xs whitespace-pre-wrap">
                  {releaseNotes}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <p className="text-muted-foreground text-sm">
              Terdapat versi baru aplikasi Mandiri Tani POS di GitHub Releases. Apakah Anda ingin mengunduhnya sekarang?
            </p>
            {releaseNotes ? (
              <div className="space-y-1.5">
                <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Perubahan / Apa yang baru:</p>
                <div className="max-h-40 overflow-y-auto rounded-lg border bg-surface-muted/50 p-3 text-xs leading-relaxed whitespace-pre-wrap">
                  {releaseNotes}
                </div>
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {isDownloading ? (
            <Button variant="outline" onClick={dismiss} className="w-full sm:w-auto">
              Sembunyikan (Lanjut Kasir)
            </Button>
          ) : isDownloaded ? (
            <>
              <Button variant="outline" onClick={dismiss}>
                Pasang Nanti Saat Tutup Kasir
              </Button>
              <Button onClick={() => void installUpdate()} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                <RefreshCw className="size-4" /> Pasang &amp; Mulai Ulang
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={dismiss}>
                Nanti Saja
              </Button>
              <Button onClick={() => void downloadUpdate()} className="gap-2">
                <Download className="size-4" /> Unduh Pembaruan
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

