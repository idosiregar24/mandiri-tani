// Stok (Sprint 4 G2): every stocked product with Fisik · Dipesan · Tersedia (FR-INV-13),
// low-stock filter (FR-INV-07) and — for the Owner — FIFO inventory value (FR-INV-12).
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, Boxes, ClipboardCheck, PackageMinus, PackageX, SlidersHorizontal, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { StockRow } from '@shared/schemas/stock';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Notice } from '@/components/shared/Notice';
import { PageHeader } from '@/components/shared/PageHeader';
import { SearchBox } from '@/components/shared/SearchBox';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
import { StatCard } from '@/components/shared/StatCard';
import { StatusPill } from '@/components/shared/StatusPill';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useImportBatches } from '@/features/imports/api';
import { useCategories } from '@/features/masters/api';
import { useConsistency, useStock, type StockListParams } from '@/features/stock/api';
import { formatNumber, formatRupiah, formatStockQty } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { stockHealth } from '@/lib/status';

function Qty({ row, value, strong }: { row: StockRow; value: string; strong?: boolean }) {
  const f = formatStockQty(value, row.baseUnitCode, row.saleUnitCode, row.saleConversion);
  return (
    <div className="tabular-nums">
      <p className={strong ? 'font-semibold' : undefined}>{f.main}</p>
      {f.detail && <p className="text-muted-foreground text-sm">{f.detail}</p>}
    </div>
  );
}

export function StockList() {
  const navigate = useNavigate();
  const canCost = useCan('cost.read');
  const canAdjust = useCan('stock.adjust');
  const canOpname = useCan('stock.opname');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<StockListParams['filter']>('all');
  const [categoryId, setCategoryId] = useState('all');
  const [page, setPage] = useState(1);
  const search = useDebouncedValue(q.trim());
  const categories = useCategories();
  const stock = useStock({
    q: search || undefined,
    filter,
    categoryId: categoryId === 'all' ? undefined : categoryId,
    page,
  });
  const consistency = useConsistency(canCost);
  const canImport = useCan('imports.ipos');
  const batches = useImportBatches(canImport);
  const stockImported = batches.data?.some((b) => b.status === 'COMMITTED' && b.scope.includes('stock'));
  const summary = stock.data?.meta.summary;

  const columns = useMemo<ColumnDef<StockRow, unknown>[]>(
    () => [
      {
        header: 'Barang',
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.name}</p>
            <p className="text-muted-foreground text-sm">
              <span className="font-mono">{row.original.sku}</span>
              {row.original.categoryName && ` · ${row.original.categoryName}`}
            </p>
          </div>
        ),
      },
      {
        header: 'Fisik',
        cell: ({ row }) => <Qty row={row.original} value={row.original.qty} />,
        meta: { align: 'right', className: 'w-36' },
      },
      {
        header: 'Dipesan',
        cell: ({ row }) =>
          row.original.reservedQty === '0.0000' ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <Qty row={row.original} value={row.original.reservedQty} />
          ),
        meta: { align: 'right', className: 'w-32' },
      },
      {
        header: 'Tersedia',
        cell: ({ row }) => <Qty row={row.original} value={row.original.availableQty} strong />,
        meta: { align: 'right', className: 'w-36' },
      },
      ...(canCost
        ? [
            {
              header: 'Nilai (HPP)',
              cell: ({ row }: { row: { original: StockRow } }) => formatRupiah(row.original.value),
              meta: { align: 'right' as const, className: 'w-40' },
            },
          ]
        : []),
      {
        header: 'Status',
        cell: ({ row }) => {
          const h = stockHealth(row.original.qty, row.original.availableQty, row.original.isLow);
          return <StatusPill tone={h.tone}>{h.label}</StatusPill>;
        },
        meta: { className: 'w-32' },
      },
    ],
    [canCost],
  );

  const filters = [
    { value: 'all', label: 'Semua' },
    { value: 'low', label: 'Menipis / habis', count: summary?.low },
    { value: 'minus', label: 'Minus', count: summary?.minus },
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stok"
        count={stock.data ? formatNumber(String(stock.data.meta.total)) : undefined}
        description="Fisik = ada di gudang · Dipesan = sudah dibeli, belum diambil · Tersedia = boleh dijual."
        actions={
          <>
            {canOpname && (
              <Button asChild variant="outline" className="h-11 text-base">
                <Link to="/opname">
                  <ClipboardCheck /> Stok Opname
                </Link>
              </Button>
            )}
            {canAdjust && (
              <Button asChild size="lg" className="h-11 text-base">
                <Link to="/penyesuaian/baru">
                  <SlidersHorizontal /> Penyesuaian Stok
                </Link>
              </Button>
            )}
          </>
        }
      />

      {canImport && batches.data && !stockImported && (
        <Notice tone="warning" title="Stok awal dari iPOS belum diimpor — semua stok masih 0.">
          <p>Buka Impor iPOS, pilih file backup, lalu jalankan langkah &quot;Impor Stok Awal&quot;.</p>
          <Button asChild variant="outline" className="mt-2 h-10 text-base">
            <Link to="/impor-ipos">Buka Impor iPOS</Link>
          </Button>
        </Notice>
      )}

      {consistency.data && consistency.data.length > 0 && (
        <Notice tone="error" title="Catatan stok tidak cocok">
          {consistency.data.length} barang punya saldo yang berbeda dengan riwayatnya (
          {consistency.data
            .map((p) => p.name)
            .slice(0, 3)
            .join(', ')}
          ). Hubungi pembuat aplikasi.
        </Notice>
      )}

      {summary && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Barang aktif" icon={Boxes} value={formatNumber(String(summary.products))} />
          <StatCard
            label="Menipis / habis"
            icon={AlertTriangle}
            value={formatNumber(String(summary.low))}
            hint="Tersedia ≤ stok minimum"
          />
          <StatCard
            label="Stok minus"
            icon={summary.minus ? PackageX : PackageMinus}
            value={formatNumber(String(summary.minus))}
            hint="Perlu dicek / opname"
          />
          {canCost && summary.totalValue !== undefined && (
            <StatCard label="Nilai persediaan" icon={Wallet} value={formatRupiah(summary.totalValue)} hint="HPP FIFO" />
          )}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="Saring stok"
          value={filter}
          options={filters}
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
        />
        <Select
          value={categoryId}
          onValueChange={(v) => {
            setCategoryId(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-11 w-52 text-base" aria-label="Kategori">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-base">
              Semua kategori
            </SelectItem>
            {categories.data?.map((c) => (
              <SelectItem key={c.id} value={c.id} className="text-base">
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SearchBox
          autoFocus
          className="ml-auto w-auto min-w-64 flex-1"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Cari nama atau kode barang…"
          aria-label="Cari stok barang"
        />
      </div>

      {stock.isError && <Notice tone="error">{stock.error.message}</Notice>}

      <DataTable
        columns={columns}
        data={stock.data?.data ?? []}
        getRowId={(r) => r.productId}
        isLoading={stock.isFetching}
        onRowClick={(r) => void navigate(`/stok/${r.productId}`)}
        paging={
          stock.data && {
            page,
            pageSize: stock.data.meta.pageSize,
            total: stock.data.meta.total,
            onPageChange: setPage,
          }
        }
        empty={
          <EmptyState icon={Boxes} title={filter === 'all' ? 'Belum ada stok' : 'Tidak ada barang di daftar ini'} />
        }
      />
    </div>
  );
}
