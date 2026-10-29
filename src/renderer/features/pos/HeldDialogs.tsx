// F6 Tahan nota / F7 Ambil nota tertahan (FR-POS-08, sprint-7 S7-1). Held notes live on the
// server, so they survive a restart; recalling one moves it back into the cart.
import { Check, Loader2, PauseCircle, PlayCircle } from 'lucide-react';
import { useState } from 'react';
import type { HoldSaleInput } from '@shared/schemas/sales';
import { Notice } from '@/components/shared/Notice';
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
import { ApiError } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';
import { cn } from '@/lib/utils';
import { holdSale, recallSale, useHeldSales } from './api';
import { focusScan } from './focus';
import { cartTotals, usePosStore } from './store';

const time = (iso: string) =>
  new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );

const closeFocus = (e: Event) => {
  e.preventDefault();
  focusScan();
};

export function HoldDialog({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const customer = usePosStore((s) => s.customer);
  const [label, setLabel] = useState(customer?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!label.trim()) return;
    const st = usePosStore.getState();
    const input: HoldSaleInput = {
      channel: st.channel,
      customerId: st.customer?.id ?? null,
      holdLabel: label.trim(),
      lines: st.lines.map((l) => ({ productUnitId: l.unitId, qty: l.qty, unitPrice: l.unitPrice })),
      discountAmount: cartTotals(st.lines, st.totalTarget).discount,
      otherCharges: st.channel === 'FAKTUR' ? st.otherCharges : '0',
      otherChargesNote: st.otherChargesNote,
    };
    setBusy(true);
    setError(null);
    try {
      await holdSale(input);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menahan nota.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={closeFocus}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <PauseCircle className="text-tani-green size-6" /> Tahan nota
          </DialogTitle>
          <DialogDescription className="text-base">
            Nota disimpan dan bisa dilanjutkan nanti (F7). Stok belum berkurang.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          <label className="block space-y-1.5">
            <span className="font-medium">Nama / keterangan</span>
            <Input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="mis. Pak Budi — ambil uang dulu"
              className="h-11 text-base md:text-base"
            />
          </label>
          {error && <Notice tone="error">{error}</Notice>}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" className="h-11 px-5" disabled={busy || !label.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} Tahan
              <kbd className="ml-1 text-xs opacity-70">Enter</kbd>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function HeldListDialog({ onRecalled, onClose }: { onRecalled: () => void; onClose: () => void }) {
  const held = useHeldSales(true);
  const rows = held.data ?? [];
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recall = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      usePosStore.getState().loadRecalled(await recallSale(id));
      onRecalled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mengambil nota.');
      void held.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-2xl"
        onCloseAutoFocus={closeFocus}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => (e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1)));
          } else if (e.key === 'Enter' && rows[active] && !busy) {
            e.preventDefault();
            void recall(rows[active].id);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <PlayCircle className="text-tani-green size-6" /> Nota tertahan
          </DialogTitle>
          <DialogDescription className="text-base">↑/↓ pilih, Enter = lanjutkan nota.</DialogDescription>
        </DialogHeader>
        {held.isPending ? (
          <p className="text-muted-foreground flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" /> Memuat…
          </p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center">Tidak ada nota tertahan.</p>
        ) : (
          <ul className="max-h-[50vh] overflow-y-auto rounded-lg border">
            {rows.map((r, i) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => void recall(r.id)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    'flex min-h-14 w-full items-center gap-3 border-b px-4 py-2 text-left last:border-b-0',
                    i === active && 'bg-tani-green-light',
                  )}
                >
                  <span className="text-muted-foreground w-12 tabular-nums">{time(r.trxAt)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{r.holdLabel}</p>
                    <p className="text-muted-foreground text-sm">
                      {r.channel === 'FAKTUR' ? 'Faktur' : 'Kasir'} · {r.customerName} · {r.itemCount} barang ·{' '}
                      {r.cashierName}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums">{formatRupiah(r.total)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </DialogContent>
    </Dialog>
  );
}
