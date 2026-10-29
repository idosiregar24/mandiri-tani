// After the sale is saved (sprint-6 C2): print right away, show the change big, Enter = next
// customer. A print failure keeps the sale and offers "Cetak ulang" (golden rule 1).
import { CheckCircle2, Loader2, PackageOpen, Printer, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { dec } from '@shared/money';
import type { PrintResult } from '@shared/printing';
import type { Sale } from '@shared/schemas/sales';
import type { StoreSettings } from '@shared/schemas/settings';
import { Notice } from '@/components/shared/Notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatRupiah } from '@/lib/format';
import { focusScan } from './focus';
import { printSale } from './print';

export type PrintState = { state: 'printing' } | { state: 'done'; result: PrintResult };

export function usePrintSale() {
  const [status, setStatus] = useState<PrintState | null>(null);
  const run = async (sale: Sale, store: StoreSettings, copy = false) => {
    setStatus({ state: 'printing' });
    setStatus({ state: 'done', result: await printSale(sale, store, { copy }) });
  };
  return { status, run };
}

export function PrintStatus({ status, onRetry }: { status: PrintState | null; onRetry: () => void }) {
  if (!status) return null;
  if (status.state === 'printing') {
    return (
      <p className="text-muted-foreground flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" /> Mencetak…
      </p>
    );
  }
  if (status.result.ok) {
    return (
      <p className="text-success-ink flex items-center gap-2">
        <Printer className="size-4" /> Tercetak.
      </p>
    );
  }
  return (
    <Notice tone="warning" title="Nota tersimpan, tetapi belum tercetak">
      <p>{status.result.message}</p>
      <Button variant="outline" className="mt-2 h-10" onClick={onRetry}>
        <RotateCcw /> Cetak ulang
      </Button>
    </Notice>
  );
}

export function SaleDoneDialog({ sale, store, onNext }: { sale: Sale; store: StoreSettings; onNext: () => void }) {
  const print = usePrintSale();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void print.run(sale, store);
  }, [print, sale, store]);
  const credit = sale.creditAmount !== '0.00';
  const received = sale.payments.reduce((sum, p) => sum.plus(p.amount), dec(0)).toFixed(2);
  const next = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onNext()}>
      <DialogContent
        className="sm:max-w-lg"
        onOpenAutoFocus={(e) => {
          // Enter = next customer, so the main button gets the focus (not the close ×).
          e.preventDefault();
          next.current?.focus();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          focusScan();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-success-ink flex items-center gap-2 text-xl">
            <CheckCircle2 className="size-6" /> Transaksi selesai
          </DialogTitle>
          <DialogDescription className="font-mono text-base">{sale.number}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <p className="text-muted-foreground">Kembalian</p>
          <p className="text-right text-6xl font-bold tabular-nums">{formatRupiah(sale.changeAmount)}</p>
          <p className="text-muted-foreground text-right">
            Total {formatRupiah(sale.total)} · uang diterima {formatRupiah(received)}
          </p>
        </div>
        {credit && (
          <Notice tone="info">
            Piutang {formatRupiah(sale.creditAmount)}, jatuh tempo {sale.dueDate?.split('-').reverse().join('/')}.
          </Notice>
        )}
        {sale.fulfillmentStatus === 'PENDING' && (
          <Notice tone="info" title="Barang belum diambil">
            <span className="flex items-center gap-2">
              <PackageOpen className="size-4" /> Stok gudang berkurang saat barang diambil (menu Pengambilan Barang).
            </span>
          </Notice>
        )}
        <PrintStatus status={print.status} onRetry={() => void print.run(sale, store)} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" className="h-11" onClick={() => void print.run(sale, store)}>
            <Printer /> Cetak lagi
          </Button>
          <Button ref={next} className="h-11 px-6 text-base" onClick={onNext}>
            Transaksi baru <kbd className="ml-1 text-xs opacity-70">Enter</kbd>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
