// Pembelian (sprint-8 B1/B3): BL invoices; a row opens its detail with the purchase return (RB).
import type { ColumnDef } from '@tanstack/react-table';
import { Loader2, Plus, Receipt, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { dec } from '@shared/money';
import type { PurchaseListItem } from '@shared/schemas/purchases';
import { uuidv7 } from '@shared/uuid';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Notice } from '@/components/shared/Notice';
import { PageHeader } from '@/components/shared/PageHeader';
import { QtyInput } from '@/components/shared/QtyInput';
import { SearchBox } from '@/components/shared/SearchBox';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
import { StatusPill } from '@/components/shared/StatusPill';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCreatePurchaseReturn, usePurchase, usePurchases } from '@/features/purchases/api';
import { formatNumber, formatQty, formatRupiah } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks';

const date = (iso: string) => iso.split('-').reverse().join('/');

function PayPill({ p }: { p: Pick<PurchaseListItem, 'payKind' | 'payableOpen'> }) {
  if (p.payKind === 'CREDIT') {
    return p.payableOpen ? (
      <StatusPill tone="warning">Hutang {formatRupiah(p.payableOpen)}</StatusPill>
    ) : (
      <StatusPill tone="success">Kredit lunas</StatusPill>
    );
  }
  return <StatusPill tone="neutral">{p.payKind === 'TRANSFER' ? 'Transfer' : 'Tunai'}</StatusPill>;
}

const columns: ColumnDef<PurchaseListItem, unknown>[] = [
  {
    header: 'Nomor',
    cell: ({ row }) => (
      <div>
        <p className="font-mono font-medium">{row.original.number}</p>
        <p className="text-muted-foreground text-sm">{date(row.original.invoiceDate)}</p>
      </div>
    ),
    meta: { className: 'w-60' },
  },
  {
    header: 'Supplier',
    cell: ({ row }) => (
      <div>
        <p className="font-medium">{row.original.supplierName}</p>
        {row.original.supplierInvoiceNo && (
          <p className="text-muted-foreground text-sm">No. {row.original.supplierInvoiceNo}</p>
        )}
      </div>
    ),
  },
  {
    header: 'Barang',
    cell: ({ row }) => `${row.original.itemCount} barang`,
    meta: { align: 'right', className: 'w-28' },
  },
  { header: 'Total', cell: ({ row }) => formatRupiah(row.original.total), meta: { align: 'right', className: 'w-40' } },
  { header: 'Bayar', cell: ({ row }) => <PayPill p={row.original} />, meta: { className: 'w-48' } },
];

export function PurchaseList() {
  const saved = (useLocation().state as { saved?: string } | null)?.saved;
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const debounced = useDebouncedValue(q.trim(), 250);
  const list = usePurchases({ q: debounced || undefined, page });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pembelian"
        count={list.data ? formatNumber(String(list.data.meta.total)) : undefined}
        description="Faktur pembelian dari supplier. Barang langsung masuk stok."
        actions={
          <Button asChild size="lg" className="h-11 text-base">
            <Link to="/pembelian/baru">
              <Plus /> Faktur Pembelian
            </Link>
          </Button>
        }
      />
      {saved && <Notice tone="success">{saved}</Notice>}
      <div className="flex justify-end">
        <SearchBox
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Cari nomor, no. faktur supplier, supplier"
        />
      </div>
      {list.isError && <Notice tone="error">{list.error.message}</Notice>}
      <DataTable
        columns={columns}
        data={list.data?.data ?? []}
        getRowId={(p) => p.id}
        isLoading={list.isFetching}
        onRowClick={(p) => setOpen(p.id)}
        paging={
          list.data && { page, pageSize: list.data.meta.pageSize, total: list.data.meta.total, onPageChange: setPage }
        }
        empty={<EmptyState icon={Receipt} title="Belum ada faktur pembelian" />}
      />
      {open && <PurchaseDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

const SETTLEMENTS = [
  { value: 'REDUCE_PAYABLE', label: 'Potong hutang' },
  { value: 'CASH_REFUND', label: 'Uang kembali ke kas' },
] as const;

function PurchaseDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const p = usePurchase(id).data;
  const [returning, setReturning] = useState(false);
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [settlement, setSettlement] = useState<'REDUCE_PAYABLE' | 'CASH_REFUND'>('CASH_REFUND');
  const [reason, setReason] = useState('');
  const [key, setKey] = useState(() => uuidv7());
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const create = useCreatePurchaseReturn(id);
  const head = 'text-muted-foreground h-10 px-3 text-sm font-medium';
  const hasPayable = !!p?.payable && dec(p.payable.amount).gt(p.payable.paidAmount);

  const submit = () => {
    if (!p) return;
    const lines = p.lines
      .filter((l) => qtys[l.id] && dec(qtys[l.id]!).gt(0))
      .map((l) => ({ receiptItemId: l.id, qty: qtys[l.id]! }));
    create.mutate(
      { input: { lines, settlement, reason }, key },
      {
        onSuccess: (next) => {
          const r = next.returns.at(-1);
          setMessage({
            tone: 'success',
            text: `Retur ${r?.number ?? ''} tersimpan — stok berkurang, ${settlement === 'CASH_REFUND' ? 'uang masuk kas' : 'hutang berkurang'}.`,
          });
          setReturning(false);
          setQtys({});
          setReason('');
          setKey(uuidv7());
        },
        onError: (err) => setMessage({ tone: 'error', text: err.message }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-xl">{p?.number ?? '…'}</DialogTitle>
          {p && (
            <DialogDescription className="text-base">
              {p.supplier.name} · {date(p.invoiceDate)}
              {p.supplierInvoiceNo && ` · No. ${p.supplierInvoiceNo}`} · dicatat {p.createdBy}
            </DialogDescription>
          )}
        </DialogHeader>
        {!p ? (
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border">
              <Table className="text-base">
                <TableHeader>
                  <TableRow className="bg-surface-muted hover:bg-surface-muted">
                    <TableHead className={head}>Barang</TableHead>
                    <TableHead className={`${head} text-right`}>Jumlah</TableHead>
                    <TableHead className={`${head} text-right`}>Harga</TableHead>
                    <TableHead className={`${head} text-right`}>Subtotal</TableHead>
                    <TableHead className={`${head} text-right`}>{returning ? 'Retur' : 'HPP / dasar'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.lines.map((l) => {
                    const left = dec(l.qty).minus(l.returnedQty);
                    return (
                      <TableRow key={l.id}>
                        <TableCell className="px-3">
                          <p className="font-medium">{l.productName}</p>
                          {dec(l.returnedQty).gt(0) && (
                            <p className="text-warning-ink text-sm">diretur {formatQty(l.returnedQty, l.unitCode)}</p>
                          )}
                        </TableCell>
                        <TableCell className="px-3 text-right tabular-nums">{formatQty(l.qty, l.unitCode)}</TableCell>
                        <TableCell className="px-3 text-right tabular-nums">{formatRupiah(l.unitPrice)}</TableCell>
                        <TableCell className="px-3 text-right tabular-nums">{formatRupiah(l.lineTotal)}</TableCell>
                        <TableCell className="px-3 text-right tabular-nums">
                          {returning ? (
                            <QtyInput
                              value={qtys[l.id] ?? ''}
                              onChange={(v) => setQtys((x) => ({ ...x, [l.id]: v }))}
                              unit={l.unitCode}
                              disabled={left.lte(0)}
                              className="ml-auto h-10 w-28"
                              aria-label={`Jumlah retur ${l.productName}`}
                            />
                          ) : (
                            formatRupiah(l.costPerBase)
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-lg">
                  Total <b className="tabular-nums">{formatRupiah(p.total)}</b>
                </p>
                {p.payable && (
                  <p className="text-muted-foreground">
                    Hutang {formatRupiah(p.payable.amount)} · terbayar/terpotong {formatRupiah(p.payable.paidAmount)} ·
                    jatuh tempo {date(p.payable.dueDate)}
                  </p>
                )}
                {p.returns.map((r) => (
                  <p key={r.id} className="text-muted-foreground text-sm">
                    Retur <span className="font-mono">{r.number}</span> · {formatRupiah(r.total)} ·{' '}
                    {r.settlement === 'REDUCE_PAYABLE' ? 'potong hutang' : 'uang kembali'}
                  </p>
                ))}
              </div>
              {!returning && (
                <Button
                  variant="outline"
                  className="h-11"
                  onClick={() => (
                    setReturning(true),
                    setMessage(null),
                    setSettlement(hasPayable ? 'REDUCE_PAYABLE' : 'CASH_REFUND')
                  )}
                >
                  <Undo2 /> Retur ke supplier
                </Button>
              )}
            </div>
            {returning && (
              <div className="space-y-3 rounded-lg border p-4">
                <SegmentedControl
                  label="Penyelesaian"
                  value={settlement}
                  options={hasPayable ? SETTLEMENTS : SETTLEMENTS.filter((s) => s.value === 'CASH_REFUND')}
                  onChange={setSettlement}
                />
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Alasan retur, mis. sak bocor"
                  className="h-11 text-base md:text-base"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" className="h-11" onClick={() => setReturning(false)}>
                    Batal
                  </Button>
                  <Button className="h-11" onClick={submit} disabled={create.isPending || reason.trim().length < 3}>
                    {create.isPending ? <Loader2 className="animate-spin" /> : <Undo2 />} Simpan retur
                  </Button>
                </div>
              </div>
            )}
            {message && <Notice tone={message.tone}>{message.text}</Notice>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
