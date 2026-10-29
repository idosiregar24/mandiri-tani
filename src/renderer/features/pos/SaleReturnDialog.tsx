// Retur jual RJ (FR-POS-17, sprint-8 B4) from "Nota hari ini / semua": qty per line, back to stock
// or not (damaged), money back from the drawer or off the customer's credit. 423 → Owner PIN.
import { Loader2, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { dec } from '@shared/money';
import type { Sale } from '@shared/schemas/sales';
import { AuthorizeDialog } from '@/components/shared/AuthorizeDialog';
import { Notice } from '@/components/shared/Notice';
import { QtyInput } from '@/components/shared/QtyInput';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { createSaleReturn } from '@/features/purchases/api';
import { ApiError } from '@/lib/api-client';
import { formatQty, formatRupiah } from '@/lib/format';
import { fetchSale } from './api';
import { Chip } from './layout';

export function SaleReturnDialog({
  saleId,
  onDone,
  onClose,
}: {
  saleId: string;
  onDone: (msg: string) => void;
  onClose: () => void;
}) {
  const [sale, setSale] = useState<Sale | null>(null);
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [damaged, setDamaged] = useState<Record<string, boolean>>({});
  const [settlement, setSettlement] = useState<'CASH_REFUND' | 'REDUCE_RECEIVABLE'>('CASH_REFUND');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approval, setApproval] = useState(false);
  const key = useRef(crypto.randomUUID()).current;

  useEffect(() => {
    void fetchSale(saleId).then(setSale, (e: Error) => setError(e.message));
  }, [saleId]);

  const lines = (sale?.lines ?? []).filter((l) => qtys[l.id] && dec(qtys[l.id]!).gt(0));
  const estimate = lines.reduce(
    (s, l) => s.plus(dec(l.lineTotal).minus(l.allocatedDiscount).times(qtys[l.id]!).div(l.qty)),
    dec(0),
  );
  const credit = sale ? dec(sale.creditAmount).gt(0) : false;

  const run = async (grant?: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await createSaleReturn(
        saleId,
        {
          lines: lines.map((l) => ({ saleItemId: l.id, qty: qtys[l.id]!, restock: !damaged[l.id] })),
          settlement,
          reason: reason.trim(),
        },
        key,
        grant,
      );
      onDone(
        `Retur ${r.number} tersimpan · ${formatRupiah(r.total)} ${settlement === 'CASH_REFUND' ? 'dikembalikan tunai dari laci' : 'mengurangi piutang'}.`,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 423) setApproval(true);
      else setError(err instanceof ApiError ? err.message : 'Gagal menyimpan retur.');
    } finally {
      setBusy(false);
    }
  };

  if (approval) {
    return (
      <AuthorizeDialog
        permission="sales.return"
        reason="Retur penjualan butuh PIN Owner."
        onCancel={() => setApproval(false)}
        onGranted={(g) => {
          setApproval(false);
          void run(g);
        }}
      />
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Undo2 className="size-5" /> Retur penjualan
          </DialogTitle>
          <DialogDescription className="text-base">
            {sale ? `${sale.number} · ${sale.customer.name} · ${formatRupiah(sale.total)}` : 'Memuat nota…'}
          </DialogDescription>
        </DialogHeader>
        {sale && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (lines.length && reason.trim().length >= 3) void run();
            }}
          >
            <ul className="divide-y rounded-lg border">
              {sale.lines.map((l) => {
                const left = dec(l.qty).minus(l.returnedQty);
                return (
                  <li key={l.id} className="grid grid-cols-[1fr_9rem_10rem] items-center gap-3 px-4 py-3">
                    <div>
                      <p className="font-medium">{l.productName}</p>
                      <p className="text-muted-foreground text-sm">
                        dibeli {formatQty(l.qty, l.unitCode)} @ {formatRupiah(l.unitPrice)}
                        {dec(l.returnedQty).gt(0) && ` · sudah diretur ${formatQty(l.returnedQty, l.unitCode)}`}
                      </p>
                    </div>
                    <QtyInput
                      value={qtys[l.id] ?? ''}
                      onChange={(v) => setQtys((x) => ({ ...x, [l.id]: v }))}
                      unit={l.unitCode}
                      disabled={left.lte(0)}
                      className="h-10"
                      aria-label={`Jumlah retur ${l.productName}`}
                    />
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={!!damaged[l.id]}
                        onCheckedChange={(v) => setDamaged((x) => ({ ...x, [l.id]: v === true }))}
                      />
                      Rusak (tidak kembali ke stok)
                    </label>
                  </li>
                );
              })}
            </ul>
            <div role="radiogroup" aria-label="Pengembalian uang" className="flex flex-wrap gap-2">
              <Chip selected={settlement === 'CASH_REFUND'} onClick={() => setSettlement('CASH_REFUND')}>
                Uang kembali (tunai)
              </Chip>
              {credit && (
                <Chip selected={settlement === 'REDUCE_RECEIVABLE'} onClick={() => setSettlement('REDUCE_RECEIVABLE')}>
                  Potong piutang
                </Chip>
              )}
            </div>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Alasan retur, mis. salah beli"
              className="h-11 text-base md:text-base"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-lg">
                Nilai retur ± <b className="tabular-nums">{formatRupiah(estimate.toFixed(2))}</b>
              </p>
              <Button type="submit" className="h-11 px-5" disabled={busy || !lines.length || reason.trim().length < 3}>
                {busy ? <Loader2 className="animate-spin" /> : <Undo2 />} Simpan retur
              </Button>
            </div>
          </form>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </DialogContent>
    </Dialog>
  );
}
