// Stok opname (FR-INV-05, Sprint 4 G5): sessions list + "Mulai Stok Opname".
import type { ColumnDef } from '@tanstack/react-table';
import { ClipboardCheck, Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { Opname } from '@shared/schemas/stock';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Notice } from '@/components/shared/Notice';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatusPill } from '@/components/shared/StatusPill';
import { Button } from '@/components/ui/button';
import { useCreateOpname, useOpnames } from '@/features/stock/api';
import { formatDateTime, formatNumber } from '@/lib/format';
import { OPNAME_STATUS } from '@/lib/status';

const columns: ColumnDef<Opname, unknown>[] = [
  {
    header: 'Nomor',
    cell: ({ row }) => (
      <div>
        <p className="font-mono font-medium">{row.original.number}</p>
        <p className="text-muted-foreground text-sm">Mulai {formatDateTime(row.original.startedAt)}</p>
      </div>
    ),
    meta: { className: 'w-72' },
  },
  { header: 'Catatan', cell: ({ row }) => row.original.note ?? '—' },
  {
    header: 'Barang dihitung',
    cell: ({ row }) => formatNumber(String(row.original.lineCount)),
    meta: { align: 'right', className: 'w-40' },
  },
  {
    header: 'Status',
    cell: ({ row }) => {
      const s = OPNAME_STATUS[row.original.status];
      return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
    },
    meta: { className: 'w-44' },
  },
];

export function OpnameList() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const list = useOpnames(page);
  const create = useCreateOpname();
  const start = () => create.mutate(null, { onSuccess: (o) => void navigate(`/opname/${o.id}`) });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stok Opname"
        count={list.data ? formatNumber(String(list.data.meta.total)) : undefined}
        description="Hitung barang di gudang, lalu posting supaya stok di aplikasi sama dengan kenyataan."
        actions={
          <Button size="lg" className="h-11 text-base" onClick={start} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Mulai Stok Opname
          </Button>
        }
      />
      {create.isError && <Notice tone="error">{create.error.message}</Notice>}
      {list.isError && <Notice tone="error">{list.error.message}</Notice>}
      <DataTable
        columns={columns}
        data={list.data?.data ?? []}
        getRowId={(o) => o.id}
        isLoading={list.isFetching}
        onRowClick={(o) => void navigate(`/opname/${o.id}`)}
        paging={
          list.data && { page, pageSize: list.data.meta.pageSize, total: list.data.meta.total, onPageChange: setPage }
        }
        empty={
          <EmptyState
            icon={ClipboardCheck}
            title="Belum ada stok opname"
            description="Mulai sesi baru saat akan menghitung barang di gudang."
          />
        }
      />
    </div>
  );
}
