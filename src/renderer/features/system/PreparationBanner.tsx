import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { apiGet, apiPost } from '@/lib/api-client';
import { useSessionUser } from '@/lib/session';

interface SystemStatus {
  isLive: boolean;
  goLiveAt: string | null;
}

interface GoLiveResult {
  isLive: boolean;
  goLiveAt: string;
  backupFile?: string | null;
  message: string;
}

export function PreparationBanner() {
  const qc = useQueryClient();
  const user = useSessionUser();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ['system', 'status'],
    queryFn: () => apiGet<SystemStatus>('/system/status'),
  });

  const goLiveMutation = useMutation({
    mutationFn: () => apiPost<GoLiveResult>('/system/go-live', { confirm: confirmText }),
    onSuccess: () => {
      setOpen(false);
      setConfirmText('');
      setErrorMsg(null);
      void qc.invalidateQueries({ queryKey: ['system', 'status'] });
      void qc.invalidateQueries({ queryKey: ['diagnostics'] });
    },
    onError: (err: Error) => {
      setErrorMsg(err.message || 'Gagal beralih ke Mode Produksi.');
    },
  });

  if (statusQuery.isLoading || statusQuery.data?.isLive) {
    return null;
  }

  const isOwner = user?.role === 'OWNER';

  return (
    <>
      <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-2 text-amber-900 print:hidden">
        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle className="size-4 text-amber-600 shrink-0" />
          <span>
            <strong>MODE PERSIAPAN:</strong> Data saat ini adalah data gladi / uji coba. Anda dapat mengimpor iPOS atau mereset data di halaman Impor.
          </span>
        </div>

        {isOwner && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setOpen(true);
              setConfirmText('');
              setErrorMsg(null);
            }}
            className="h-7 border-amber-600/40 text-amber-900 hover:bg-amber-500/20 text-xs font-semibold gap-1.5"
          >
            <Sparkles className="size-3.5 text-amber-600" /> Nyatakan Go-Live
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="bg-amber-100 text-amber-700 size-9 rounded-lg flex items-center justify-center">
                <Sparkles className="size-5" />
              </div>
              <DialogTitle className="text-lg">Nyatakan Go-Live (Mode Produksi)</DialogTitle>
            </div>
            <DialogDescription className="space-y-3 pt-2 text-foreground text-xs leading-relaxed">
              <p>
                Dengan menyatakan <strong>Go-Live</strong>, toko Mandiri Tani resmi mulai beroperasi secara penuh menggunakan sistem baru:
              </p>
              <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                <li>Sistem akan otomatis membuat file cadangan (backup) pra-go-live.</li>
                <li>Fitur impor iPOS dan reset data persiapan akan <strong>dikunci selamanya</strong>.</li>
                <li>Seluruh transaksi kasir, stok, dan kas setelah ini adalah transaksi resmi toko.</li>
              </ul>
              <div className="rounded-lg bg-surface-muted p-3 space-y-1.5 border">
                <p className="font-semibold text-foreground">
                  Ketik persis <span className="font-mono text-primary font-bold">GO LIVE</span> untuk konfirmasi:
                </p>
                <Input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="GO LIVE"
                  className="font-mono uppercase text-sm"
                  autoFocus
                />
              </div>
              {errorMsg && (
                <p className="text-error-ink font-medium">{errorMsg}</p>
              )}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={goLiveMutation.isPending}>
              Batal
            </Button>
            <Button
              disabled={confirmText !== 'GO LIVE' || goLiveMutation.isPending}
              onClick={() => goLiveMutation.mutate()}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700 font-semibold"
            >
              {goLiveMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              {goLiveMutation.isPending ? 'Memproses Go-Live...' : 'Konfirmasi & Mulai Go-Live'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

