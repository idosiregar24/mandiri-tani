// Kartu stok (FR-INV-02, Sprint 4 G3): opening balance, every movement with its document and a
// running balance, closing balance; the Owner also sees HPP per movement and the open FIFO layers.
import { ArrowLeft, Boxes, PackageCheck, PackageOpen, ShoppingBag } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Notice } from '@/components/shared/Notice';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { StatusPill } from '@/components/shared/StatusPill';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCostLayers, useStockCard } from '@/features/stock/api';
import { formatDate, formatDateTime, formatNumber, formatRupiah, formatStockQty } from '@/lib/format';
import { useCan } from '@/lib/session';
import { STOCK_SOURCE_LABELS } from '@/lib/status';
import { cn } from '@/lib/utils';

const head = 'text-muted-foreground h-11 px-4 text-sm font-medium';
const num = 'px-4 text-right tabular-nums';

export function StockCardPage() {
  const { productId = '' } = useParams();
  const canCost = useCan('cost.read');
  const [from, setFrom] = useState<string | undefined>();
  const [to, setTo] = useState<string | undefined>();
  const card = useStockCard(productId, from, to);
  const layers = useCostLayers(productId, canCost);
  const c = card.data;
  const fmt = (v: string) =>
    c ? formatStockQty(v, c.baseUnitCode, c.saleUnitCode, c.saleConversion) : { main: '', detail: null };
  const base = (v: string) => (v === '0.0000' ? '' : formatNumber(v));

  return (
    <div className="space-y-6">
      <Link to="/stok" className="text-muted-foreground inline-flex items-center gap-2 text-base hover:underline">
        <ArrowLeft className="size-5" /> Kembali ke daftar stok
      </Link>
      {card.isError && <Notice tone="error">{card.error.message}</Notice>}
      {c && (
        <>
          <PageHeader title={c.name} description={<span className="font-mono">{c.sku}</span>} />

          <section className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Fisik"
              icon={Boxes}
              value={fmt(c.current.qty).main}
              hint={fmt(c.current.qty).detail ?? 'Ada di gudang'}
            />
            <StatCard
              label="Dipesan"
              icon={ShoppingBag}
              value={fmt(c.current.reservedQty).main}
              hint="Sudah dibeli, belum diambil"
            />
            <StatCard
              label="Tersedia"
              icon={PackageCheck}
              value={fmt(c.current.availableQty).main}
              hint="Boleh dijual"
            />
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-lg font-semibold">Kartu stok ({c.baseUnitCode.toLowerCase()})</h2>
              <div className="flex items-end gap-2 text-base">
                <label className="space-y-1">
                  <span className="text-muted-foreground block text-sm">Dari</span>
                  <Input
                    type="date"
                    value={from ?? c.from}
                    onChange={(e) => setFrom(e.target.value || undefined)}
                    className="h-11 w-44 text-base md:text-base"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-muted-foreground block text-sm">Sampai</span>
                  <Input
                    type="date"
                    value={to ?? c.to}
                    onChange={(e) => setTo(e.target.value || undefined)}
                    className="h-11 w-44 text-base md:text-base"
                  />
                </label>
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border">
              <Table className="text-base">
                <TableHeader>
                  <TableRow className="bg-surface-muted hover:bg-surface-muted">
                    <TableHead className={head}>Tanggal</TableHead>
                    <TableHead className={head}>Dokumen</TableHead>
                    <TableHead className={cn(head, 'text-right')}>Masuk</TableHead>
                    <TableHead className={cn(head, 'text-right')}>Keluar</TableHead>
                    <TableHead className={cn(head, 'text-right')}>Saldo</TableHead>
                    {canCost && (
                      <TableHead className={cn(head, 'text-right')}>HPP / {c.baseUnitCode.toLowerCase()}</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-surface-muted/50">
                    <TableCell className="px-4">{formatDate(c.from)}</TableCell>
                    <TableCell className="px-4 font-medium">Saldo awal periode</TableCell>
                    <TableCell className={num} />
                    <TableCell className={num} />
                    <TableCell className={cn(num, 'font-medium')}>{formatNumber(c.opening)}</TableCell>
                    {canCost && <TableCell className={num} />}
                  </TableRow>
                  {c.lines.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={canCost ? 6 : 5} className="text-muted-foreground px-4 py-6 text-center">
                        Tidak ada mutasi di periode ini.
                      </TableCell>
                    </TableRow>
                  )}
                  {c.lines.map((l, i) => (
                    <TableRow key={`${l.sourceId}-${i}`} className="h-14">
                      <TableCell className="px-4 whitespace-nowrap">{formatDateTime(l.movedAt)}</TableCell>
                      <TableCell className="px-4">
                        <p className="font-medium">
                          {l.document.includes('/') ? l.document : (STOCK_SOURCE_LABELS[l.sourceType] ?? l.document)}
                        </p>
                        <p className="text-muted-foreground text-sm">
                          {[l.document.includes('/') ? STOCK_SOURCE_LABELS[l.sourceType] : null, l.note]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </TableCell>
                      <TableCell className={cn(num, 'text-success-ink')}>{base(l.qtyIn)}</TableCell>
                      <TableCell className={cn(num, 'text-error-ink')}>{base(l.qtyOut)}</TableCell>
                      <TableCell className={cn(num, 'font-medium')}>{formatNumber(l.balance)}</TableCell>
                      {canCost && (
                        <TableCell className={num}>
                          {formatRupiah(l.unitCost)}
                          {l.costEstimated && (
                            <StatusPill tone="warning" className="ml-2">
                              estimasi
                            </StatusPill>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  <TableRow className="bg-surface-muted/50 font-medium">
                    <TableCell className="px-4">{formatDate(c.to)}</TableCell>
                    <TableCell className="px-4">Saldo akhir periode</TableCell>
                    <TableCell className={cn(num, 'text-success-ink')}>{formatNumber(c.totalIn)}</TableCell>
                    <TableCell className={cn(num, 'text-error-ink')}>{formatNumber(c.totalOut)}</TableCell>
                    <TableCell className={num}>{formatNumber(c.closing)}</TableCell>
                    {canCost && <TableCell className={num} />}
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </section>

          {canCost && layers.data && (
            <section className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold">Lapisan HPP (FIFO)</h2>
                <p className="text-muted-foreground text-base">
                  Barang keluar memakai lapisan paling atas (paling lama) lebih dulu.
                </p>
              </div>
              {layers.data.length === 0 ? (
                <Notice tone="info">Tidak ada lapisan tersisa.</Notice>
              ) : (
                <div className="overflow-hidden rounded-xl border">
                  <Table className="text-base">
                    <TableHeader>
                      <TableRow className="bg-surface-muted hover:bg-surface-muted">
                        <TableHead className={head}>Masuk</TableHead>
                        <TableHead className={head}>Asal</TableHead>
                        <TableHead className={cn(head, 'text-right')}>Sisa</TableHead>
                        <TableHead className={cn(head, 'text-right')}>HPP / {c.baseUnitCode.toLowerCase()}</TableHead>
                        <TableHead className={cn(head, 'text-right')}>Nilai</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {layers.data.map((l) => (
                        <TableRow key={l.id} className="h-12">
                          <TableCell className="px-4">{formatDateTime(l.receivedAt)}</TableCell>
                          <TableCell className="px-4">{STOCK_SOURCE_LABELS[l.sourceType] ?? l.sourceType}</TableCell>
                          <TableCell className={num}>{formatNumber(l.qtyRemaining)}</TableCell>
                          <TableCell className={num}>{formatRupiah(l.unitCost)}</TableCell>
                          <TableCell className={num}>{formatRupiah(l.value)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          )}
        </>
      )}
      {!c && !card.isError && (
        <PackageOpen className="text-muted-foreground mx-auto mt-16 size-8 animate-pulse" aria-label="Memuat" />
      )}
    </div>
  );
}
