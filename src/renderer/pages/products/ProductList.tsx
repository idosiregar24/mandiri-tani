import type { ColumnDef } from '@tanstack/react-table';
import { Boxes, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { ProductListItem } from '@shared/schemas/master';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Notice } from '@/components/shared/Notice';
import { PageHeader } from '@/components/shared/PageHeader';
import { RowActions } from '@/components/shared/RowActions';
import { SearchBox } from '@/components/shared/SearchBox';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
import { ActivePill } from '@/components/shared/StatusPill';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCategories } from '@/features/masters/api';
import { useProducts, useRemoveProduct } from '@/features/products/api';
import { formatNumber, formatRupiah } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks';
import { useCan } from '@/lib/session';

const STATUS = [
  { value: 'active', label: 'Aktif' },
  { value: 'all', label: 'Semua' },
] as const;

export function ProductList() {
  const navigate = useNavigate();
  const saved = (useLocation().state as { saved?: string } | null)?.saved;
  const canWrite = useCan('products.write');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [status, setStatus] = useState<'active' | 'all'>('active');
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState<ProductListItem | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(
    saved ? { tone: 'success', text: saved } : null,
  );
  const search = useDebouncedValue(q.trim());
  const categories = useCategories();
  const remove = useRemoveProduct();
  const products = useProducts({
    q: search || undefined,
    categoryId: categoryId === 'all' ? undefined : categoryId,
    includeInactive: status === 'all',
    page,
  });

  const columns = useMemo<ColumnDef<ProductListItem, unknown>[]>(
    () => [
      {
        header: 'Barang',
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.name}</p>
            <p className="text-muted-foreground font-mono text-sm">{row.original.sku}</p>
          </div>
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
      {
        header: 'Status',
        cell: ({ row }) => <ActivePill active={row.original.isActive} />,
        meta: { className: 'w-32' },
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) =>
          canWrite && (
            <RowActions
              label={`Aksi untuk ${row.original.name}`}
              actions={[
                { label: 'Ubah', icon: Pencil, onSelect: () => void navigate(`/barang/${row.original.id}`) },
                { label: 'Hapus barang', icon: Trash2, danger: true, onSelect: () => setDeleting(row.original) },
              ]}
            />
          ),
        meta: { className: 'w-16', align: 'right' },
      },
    ],
    [canWrite, navigate],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Barang"
        count={products.data ? formatNumber(String(products.data.meta.total)) : undefined}
        description="Daftar barang dengan satuan dan harga jualnya."
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

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="Status barang"
          value={status}
          options={STATUS}
          onChange={(v) => {
            setStatus(v);
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
        <SearchBox
          autoFocus
          className="ml-auto"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Cari nama, kode, atau scan barcode…"
          aria-label="Cari barang"
        />
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

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          tone="danger"
          title={`Hapus "${deleting.name}"?`}
          description="Barang tidak tampil lagi di daftar dan tidak bisa dijual. Riwayat transaksinya tetap tersimpan."
          confirmLabel="Hapus barang"
          pending={remove.isPending}
          onConfirm={() =>
            remove.mutate(deleting.id, {
              onSuccess: () => setMessage({ tone: 'success', text: `Barang "${deleting.name}" dihapus.` }),
              onError: (err) => setMessage({ tone: 'error', text: err.message }),
              onSettled: () => setDeleting(null),
            })
          }
        />
      )}
    </div>
  );
}
