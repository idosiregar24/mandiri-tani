// Today's notes (sprint-6 C3): reprint marked SALINAN (FR-POS-15), void with a reason and the
// Owner PIN (FR-POS-16, today only — S6-2). Keyboard: type to search, ↑/↓, Enter = reprint.
import { useQueryClient } from '@tanstack/react-query';
import { Ban, Loader2, Printer, Search, Undo2 } from 'lucide-react';
import { useState } from 'react';
import type { Permission } from '@shared/permissions';
import type { Sale, SaleListItem } from '@shared/schemas/sales';
import type { StoreSettings } from '@shared/schemas/settings';
import { AuthorizeDialog } from '@/components/shared/AuthorizeDialog';
import { Notice } from '@/components/shared/Notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { fetchSale, todayJakarta, useTodaySales, voidSale } from './api';
import { Chip } from './layout';
import { SaleReturnDialog } from './SaleReturnDialog';
import { focusScan } from './focus';
import { PrintStatus, usePrintSale } from './SaleDoneDialog';

const time = (iso: string) =>
  new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );

export function HistoryDialog({ store, onClose }: { store: StoreSettings; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [voiding, setVoiding] = useState<SaleListItem | null>(null);
  const [returning, setReturning] = useState<string | null>(null);
  const [allDates, setAllDates] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const debounced = useDebouncedValue(q.trim(), 200);
  const sales = useTodaySales(true, debounced, allDates);
  const rows = sales.data?.data ?? [];
  const print = usePrintSale();
  const qc = useQueryClient();

  const reprint = async (row: SaleListItem) => {
    setNotice(null);
    const sale = await fetchSale(row.id);
    await print.run(sale, store, true);
  };

  return (
    <>
      <Dialog open={!voiding && !returning} onOpenChange={(o) => !o && onClose()}>
        <DialogContent
          className="sm:max-w-3xl"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            focusScan();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-xl">{allDates ? 'Semua nota' : 'Nota hari ini'}</DialogTitle>
            <DialogDescription className="text-base">
              Enter = cetak ulang (SALINAN). Batal hanya untuk nota hari ini; nota lama dikoreksi dengan Retur.
            </DialogDescription>
          </DialogHeader>
          <div role="radiogroup" aria-label="Tanggal" className="flex gap-2">
            <Chip selected={!allDates} onClick={() => (setAllDates(false), setActive(0))}>
              Hari ini
            </Chip>
            <Chip selected={allDates} onClick={() => (setAllDates(true), setActive(0))}>
              Semua tanggal
            </Chip>
          </div>
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((i) => (e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1)));
                } else if (e.key === 'Enter' && rows[active]) {
                  e.preventDefault();
                  void reprint(rows[active]);
                }
              }}
              placeholder="Cari nomor nota atau nama pelanggan"
              className="h-12 pl-11 text-lg md:text-lg"
            />
          </div>
          <div className="max-h-[50vh] overflow-y-auto rounded-lg border">
            {sales.isPending ? (
              <p className="text-muted-foreground flex items-center gap-2 p-4">
                <Loader2 className="size-4 animate-spin" /> Memuat…
              </p>
            ) : rows.length === 0 ? (
              <p className="text-muted-foreground p-4">Belum ada nota hari ini.</p>
            ) : (
              <ul>
                {rows.map((r, i) => (
                  <li
                    key={r.id}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      'flex min-h-14 items-center gap-3 border-b px-4 py-2 last:border-b-0',
                      i === active && 'bg-tani-green-light',
                    )}
                  >
                    <span className="text-muted-foreground w-12 tabular-nums">{time(r.trxAt)}</span>
                    <div className="min-w-0 flex-1">
                      <p className={cn('font-mono font-medium', r.status === 'VOIDED' && 'line-through')}>{r.number}</p>
                      <p className="text-muted-foreground truncate text-sm">
                        {r.customerName} · {r.itemCount} barang
                        {r.status === 'VOIDED' && <span className="text-error-ink ml-2 font-medium">DIBATALKAN</span>}
                        {r.fulfillmentStatus === 'PENDING' && (
                          <span className="text-warning-ink ml-2">belum diambil</span>
                        )}
                      </p>
                    </div>
                    <span className="w-36 text-right font-semibold tabular-nums">{formatRupiah(r.total)}</span>
                    <Button variant="outline" size="sm" className="h-9" onClick={() => void reprint(r)}>
                      <Printer /> Cetak
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9"
                      disabled={r.status === 'VOIDED'}
                      onClick={() => (setNotice(null), setReturning(r.id))}
                    >
                      <Undo2 /> Retur
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-error-ink h-9"
                      disabled={r.status === 'VOIDED' || todayJakarta(r.trxAt) !== todayJakarta()}
                      onClick={() => setVoiding(r)}
                    >
                      <Ban /> Batal
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <PrintStatus status={print.status} onRetry={() => rows[active] && void reprint(rows[active])} />
          {notice && <Notice tone="success">{notice}</Notice>}
        </DialogContent>
      </Dialog>
      {returning && (
        <SaleReturnDialog
          saleId={returning}
          onClose={() => setReturning(null)}
          onDone={(msg) => {
            setReturning(null);
            setNotice(msg);
            void sales.refetch();
            void qc.invalidateQueries({ queryKey: ['pos', 'products'] });
          }}
        />
      )}
      {voiding && (
        <VoidDialog
          row={voiding}
          onClose={() => setVoiding(null)}
          onVoided={(s) => {
            setVoiding(null);
            setNotice(`Nota ${s.number} dibatalkan. Stok dan kas sudah dikembalikan.`);
            void sales.refetch();
            // Stock is back in the warehouse: search results must show it.
            void qc.invalidateQueries({ queryKey: ['pos', 'products'] });
          }}
        />
      )}
    </>
  );
}

function VoidDialog({
  row,
  onClose,
  onVoided,
}: {
  row: SaleListItem;
  onClose: () => void;
  onVoided: (s: Sale) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approval, setApproval] = useState<{ permission: Permission; reason: string } | null>(null);

  const run = async (grant?: string) => {
    setBusy(true);
    setError(null);
    try {
      onVoided(await voidSale(row.id, reason.trim(), grant));
    } catch (err) {
      if (err instanceof ApiError && err.status === 423)
        setApproval({ permission: 'sales.void', reason: 'Membatalkan nota butuh PIN Owner.' });
      else setError(err instanceof ApiError ? err.message : 'Gagal membatalkan nota.');
    } finally {
      setBusy(false);
    }
  };

  if (approval) {
    return (
      <AuthorizeDialog
        permission={approval.permission}
        reason={approval.reason}
        onCancel={() => setApproval(null)}
        onGranted={(g) => {
          setApproval(null);
          void run(g);
        }}
      />
    );
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">Batalkan nota?</DialogTitle>
          <DialogDescription className="text-base">
            {row.number} — {formatRupiah(row.total)}. Stok kembali ke gudang dan uang dicatat keluar dari kas.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim().length >= 3) void run();
          }}
          className="space-y-4"
        >
          <label className="block space-y-1.5">
            <span className="font-medium">Alasan</span>
            <Input
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="mis. salah input barang"
              className="h-11 text-base md:text-base"
            />
          </label>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>
              Kembali
            </Button>
            <Button type="submit" variant="destructive" className="h-11" disabled={busy || reason.trim().length < 3}>
              {busy ? <Loader2 className="animate-spin" /> : <Ban />} Batalkan nota
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
