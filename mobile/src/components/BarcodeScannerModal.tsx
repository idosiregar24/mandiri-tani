import { useEffect, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
  title?: string;
}

export function BarcodeScannerModal({ isOpen, onClose, onScan, title = 'Pindai Barcode' }: BarcodeScannerModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const readerElementId = 'mt-barcode-reader';

  useEffect(() => {
    if (!isOpen) return;

    let isSubscribed = true;
    setError(null);

    const timer = setTimeout(() => {
      try {
        const html5QrCode = new Html5Qrcode(readerElementId);
        scannerRef.current = html5QrCode;

        html5QrCode
          .start(
            { facingMode: 'environment' },
            {
              fps: 10,
              qrbox: { width: 260, height: 160 },
              aspectRatio: 1.0,
            },
            (decodedText) => {
              if (isSubscribed) {
                // Vibration feedback if supported
                if ('vibrate' in navigator) navigator.vibrate(50);
                onScan(decodedText);
                onClose();
              }
            },
            () => {
              // Frame scan error (normal when no code in frame)
            },
          )
          .catch((err) => {
            if (isSubscribed) {
              setError(
                typeof err === 'string'
                  ? err
                  : 'Kamera tidak dapat diakses. Pastikan izin kamera aktif atau gunakan input manual di bawah.',
              );
            }
          });
      } catch (e) {
        if (isSubscribed) {
          setError('Gagal menginisialisasi kamera.');
        }
      }
    }, 100);

    return () => {
      isSubscribed = false;
      clearTimeout(timer);
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .catch(() => {})
          .finally(() => {
            scannerRef.current?.clear();
            scannerRef.current = null;
          });
      }
    };
  }, [isOpen, onScan, onClose]);

  if (!isOpen) return null;

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualCode.trim()) {
      onScan(manualCode.trim());
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col justify-between p-4 backdrop-blur-sm">
      <div className="flex items-center justify-between text-white pt-2">
        <div className="flex items-center gap-2">
          <Camera className="size-5 text-emerald-400" />
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="size-8 rounded-full bg-white/20 flex items-center justify-center text-white active:scale-95"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="my-auto flex flex-col items-center">
        <div
          id={readerElementId}
          className="w-full max-w-xs overflow-hidden rounded-2xl border-2 border-emerald-500/80 bg-black shadow-lg"
          style={{ minHeight: '260px' }}
        />

        {error ? (
          <p className="mt-3 text-center text-xs text-amber-300 max-w-xs">{error}</p>
        ) : (
          <p className="mt-3 text-center text-xs text-slate-300">
            Arahkan kamera ke barcode produk atau QR code
          </p>
        )}
      </div>

      {/* Manual barcode entry fallback */}
      <form onSubmit={handleManualSubmit} className="w-full max-w-sm mx-auto pb-4">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Atau ketik barcode / SKU..."
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            className="flex-1 bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:border-emerald-400"
          />
          <button
            type="submit"
            disabled={!manualCode.trim()}
            className="px-4 py-2 bg-emerald-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium active:scale-95"
          >
            Cari
          </button>
        </div>
      </form>
    </div>
  );
}

