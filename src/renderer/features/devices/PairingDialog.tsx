import { useCallback, useEffect, useState } from 'react';
import type { PairingCodeResult } from '@shared/schemas/devices';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { QrCodeSvg } from '@/components/shared/QrCodeSvg';
import { useCreatePairingCode } from './api';
import { Loader2, RefreshCw, Smartphone, Monitor } from 'lucide-react';

type PairingKind = 'TERMINAL' | 'MOBILE';

interface PairingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PairingDialog({ open, onOpenChange }: PairingDialogProps) {
  const [kind, setKind] = useState<PairingKind>('MOBILE');
  const [pairingData, setPairingData] = useState<PairingCodeResult | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);

  const createCode = useCreatePairingCode();

  const handleGenerate = useCallback((selectedKind: PairingKind) => {
    createCode.mutate(
      { kind: selectedKind },
      {
        onSuccess: (data) => {
          setPairingData(data);
          const expiresMs = Date.parse(data.expiresAt) - Date.now();
          setSecondsLeft(Math.max(0, Math.floor(expiresMs / 1000)));
        },
      },
    );
  }, [createCode]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const interval = setInterval(() => {
      setSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [secondsLeft]);

  const handleClose = () => {
    setPairingData(null);
    setSecondsLeft(0);
    onOpenChange(false);
  };

  const formatCountdown = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const formattedPin = pairingData
    ? `${pairingData.code.slice(0, 3)} ${pairingData.code.slice(3)}`
    : '--- ---';

  return (
    <Dialog open={open} onOpenChange={(isOpen) => (!isOpen ? handleClose() : onOpenChange(true))}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pasangkan Perangkat Baru</DialogTitle>
          <DialogDescription>
            Pindai kode QR atau ketikkan PIN 6 digit untuk menyambungkan HP staf atau terminal kasir ke Hub LAN ini.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Device Type Selector */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant={kind === 'MOBILE' ? 'default' : 'outline'}
              className="flex-1 gap-2"
              onClick={() => {
                setKind('MOBILE');
                if (pairingData) handleGenerate('MOBILE');
              }}
              disabled={createCode.isPending}
            >
              <Smartphone className="size-4" />
              HP Staf (Mobile)
            </Button>
            <Button
              type="button"
              variant={kind === 'TERMINAL' ? 'default' : 'outline'}
              className="flex-1 gap-2"
              onClick={() => {
                setKind('TERMINAL');
                if (pairingData) handleGenerate('TERMINAL');
              }}
              disabled={createCode.isPending}
            >
              <Monitor className="size-4" />
              Terminal Kasir
            </Button>
          </div>

          {createCode.isPending ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="size-8 animate-spin text-emerald-600" />
              <p className="text-sm text-slate-500">Menghasilkan kode pairing...</p>
            </div>
          ) : pairingData ? (
            <div className="flex flex-col items-center gap-4">
              {/* QR Code */}
              <div className="relative">
                <QrCodeSvg value={pairingData.qrData} size={200} />
                {secondsLeft === 0 && (
                  <div className="absolute inset-0 bg-white/90 backdrop-blur-xs flex flex-col items-center justify-center p-4 text-center rounded border border-slate-200">
                    <p className="text-sm font-semibold text-rose-600">Kode Kedaluwarsa</p>
                    <p className="text-xs text-slate-500 mt-1 mb-3">Kode berlaku 5 menit demi keamanan.</p>
                    <Button size="sm" onClick={() => handleGenerate(kind)}>
                      <RefreshCw className="size-3.5 mr-1.5" />
                      Buat Kode Baru
                    </Button>
                  </div>
                )}
              </div>

              {/* PIN Code Display */}
              <div className="text-center">
                <span className="text-xs text-slate-500 uppercase tracking-wider font-medium">
                  Atau masukkan PIN 6 Digit
                </span>
                <div className="text-3xl font-mono font-bold tracking-widest text-slate-900 bg-slate-100 px-6 py-2 rounded-lg mt-1 border border-slate-200">
                  {formattedPin}
                </div>
                <div className="mt-2 flex items-center justify-center gap-2 text-xs">
                  <span className="text-slate-500">Berlaku selama:</span>
                  <span className={`font-mono font-semibold ${secondsLeft < 60 ? 'text-rose-600' : 'text-emerald-700'}`}>
                    {formatCountdown(secondsLeft)}
                  </span>
                </div>
              </div>

              {/* Instruction list */}
              <div className="w-full bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-600 space-y-1">
                <p><strong>1.</strong> Pastikan perangkat terhubung ke Wi-Fi / LAN yang sama.</p>
                <p><strong>2.</strong> Buka aplikasi Mandiri Tani pada perangkat tersebut.</p>
                <p><strong>3.</strong> Pindai QR di atas atau masukkan PIN 6 digit.</p>
                <p className="text-slate-400 font-mono text-[11px] pt-1">Hub URL: {pairingData.hubUrl}</p>
              </div>
            </div>
          ) : (
            <div className="text-center py-10 space-y-3">
              <p className="text-sm text-slate-500">
                Klik tombol di bawah untuk membuat QR dan kode PIN baru.
              </p>
              <Button
                onClick={() => handleGenerate(kind)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                Buat Kode Pairing
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {pairingData && secondsLeft > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleGenerate(kind)}
              disabled={createCode.isPending}
            >
              <RefreshCw className="size-3.5 mr-1.5" />
              Perbarui Kode
            </Button>
          )}
          <Button type="button" variant="outline" onClick={handleClose}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
