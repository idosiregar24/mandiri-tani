import type { ColumnDef } from '@tanstack/react-table';
import { Boxes, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { ProductListItem } from '@shared/schemas/master';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Notice } from '@/components/shared/Notice';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCategories } from '@/features/masters/api';
import { useProducts } from '@/features/products/api';
import { formatNumber, formatRupiah } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks';
import { useCan } from '@/lib/session';

const columns: ColumnDef<ProductListItem, unknown>[] = [
  { header: 'Kode', accessorKey: 'sku', meta: { className: 'w-36 font-mono text-sm' } },
  {
    header: 'Nama barang',
    cell: ({ row }) => (
      <span className="font-medium">
        {row.original.name}
        {!row.original.isActive && (
          <Badge variant="outline" className="ml-2 text-sm">
            Nonaktif
          </Badge>
        )}
      </span>
    ),
  },
  { header: 'Kategori', cell: ({ row }) => row.original.categoryName ?? '—', meta: { className: 'w-44' } },
  {
    header: 'Satuan & harga jual',
    cell: ({ row }) => (
      <ul className="space-y-0.5">
        {row.original.units.map((u) => (
          <li key={u.unitCode} className="flex justify-between gap-6 tabular-nums">
            <span>
              {u.unitCode}
              {u.conversionQty !== '1' && (
                <span className="text-muted-foreground">
                  {' '}
                  = {formatNumber(u.conversionQty)} {row.original.baseUnitCode}
                </span>
              )}
            </span>
            <span>{formatRupiah(u.price)}</span>
          </li>
        ))}
      </ul>
    ),
    meta: { className: 'w-80' },
  },
];

export function ProductList() {
  const navigate = useNavigate();
  const saved = (useLocation().state as { saved?: string } | null)?.saved;
  const canWrite = useCan('products.write');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const search = useDebouncedValue(q.trim());
  const categories = useCategories();
  const products = useProducts({
    q: search || undefined,
    categoryId: categoryId === 'all' ? undefined : categoryId,
    includeInactive,
    page,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Barang"
        description="Daftar barang dengan satuan dan harga jualnya."
        icon={Boxes}
        actions={
          canWrite && (
            <Button asChild size="lg" className="h-11 text-base">
              <Link to="/barang/baru">
                <Plus /> Tambah Barang
              </Link>
            </Button>
          )
        }
      />

      {saved && <Notice tone="success">{saved}</Notice>}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-md">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-5 -translate-y-1/2" aria-hidden />
          <Input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Cari nama, kode, atau scan barcode…"
            aria-label="Cari barang"
            className="h-11 pl-10 text-base md:text-base"
          />
        </div>
        <Select
          value={categoryId}
          onValueChange={(v) => {
            setCategoryId(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-11 w-56 text-base" aria-label="Kategori">
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
        <label className="flex h-11 items-center gap-2 text-base">
          <Checkbox
            checked={includeInactive}
            onCheckedChange={(v) => {
              setIncludeInactive(v === true);
              setPage(1);
            }}
            className="size-5"
          />
          Tampilkan yang nonaktif
        </label>
      </div>

      {products.isError && <Notice tone="error">{products.error.message}</Notice>}

      <DataTable
        columns={columns}
        data={products.data?.data ?? []}
        getRowId={(p) => p.id}
        isLoading={products.isFetching}
        onRowClick={(p) => void navigate(`/barang/${p.id}`)}
        isRowMuted={(p) => !p.isActive}
        paging={
          products.data && {
            page,
            pageSize: products.data.meta.pageSize,
            total: products.data.meta.total,
            onPageChange: setPage,
          }
        }
        empty={
          <EmptyState
            icon={Boxes}
            title={search ? 'Barang tidak ditemukan' : 'Belum ada barang'}
            description={
              search
                ? `Tidak ada barang dengan kata "${search}".`
                : 'Tambahkan barang satu per satu, atau impor semua barang dari iPOS.'
            }
            action={
              !search &&
              canWrite && (
                <Button asChild variant="outline" className="h-11 text-base">
                  <Link to="/impor-ipos">Impor dari iPOS</Link>
                </Button>
              )
            }
          />
        }
      />
    </div>
  );
}
