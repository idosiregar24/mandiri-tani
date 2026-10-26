// Penyesuaian stok (FR-INV-06, Sprint 4 G4): list of PS documents; a row opens its lines.
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import type { Adjustment } from '@shared/schemas/stock';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Notice } from '@/components/shared/Notice';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatusPill } from '@/components/shared/StatusPill';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAdjustment, useAdjustments } from '@/features/stock/api';
import { formatDateTime, formatNumber, formatRupiah } from '@/lib/format';
import { useCan } from '@/lib/session';
import { ADJUSTMENT_REASON } from '@/lib/status';
import { cn } from '@/lib/utils';

export function AdjustmentList() {
  const saved = (useLocation().state as { saved?: string } | null)?.saved;
  const canCost = useCan('cost.read');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const list = useAdjustments(page);

  const columns = useMemo<ColumnDef<Adjustment, unknown>[]>(
    () => [
      {
        header: 'Nomor',
        cell: ({ row }) => (
          <div>
            <p className="font-mono font-medium">{row.original.number}</p>
            <p className="text-muted-foreground text-sm">{formatDateTime(row.original.trxAt)}</p>
          </div>
        ),
        meta: { className: 'w-64' },
      },
      {
        header: 'Alasan',
        cell: ({ row }) => {
          const r = ADJUSTMENT_REASON[row.original.reasonCode];
          return <StatusPill tone={r.tone}>{r.label}</StatusPill>;
        },
        meta: { className: 'w-40' },
      },
      { header: 'Catatan', cell: ({ row }) => row.original.note ?? '—' },
      {
        header: 'Barang',
        cell: ({ row }) => `${row.original.lineCount} barang`,
        meta: { align: 'right', className: 'w-28' },
      },
      ...(canCost
        ? [
            {
              header: 'Nilai',
              cell: ({ row }: { row: { original: Adjustment } }) => formatRupiah(row.original.value),
              meta: { align: 'right' as const, className: 'w-40' },
            },
          ]
        : []),
    ],
    [canCost],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Penyesuaian Stok"
        count={list.data ? formatNumber(String(list.data.meta.total)) : undefined}
        description="Koreksi stok karena barang rusak, hilang, kedaluwarsa, atau dipakai sampel."
        actions={
          <Button asChild size="lg" className="h-11 text-base">
            <Link to="/penyesuaian/baru">
              <Plus /> Buat Penyesuaian
            </Link>
          </Button>
        }
      />
      {saved && <Notice tone="success">{saved}</Notice>}
      {list.isError && <Notice tone="error">{list.error.message}</Notice>}
      <DataTable
        columns={columns}
        data={list.data?.data ?? []}
        getRowId={(a) => a.id}
        isLoading={list.isFetching}
        onRowClick={(a) => setOpen(a.id)}
        paging={
          list.data && { page, pageSize: list.data.meta.pageSize, total: list.data.meta.total, onPageChange: setPage }
        }
        empty={<EmptyState icon={SlidersHorizontal} title="Belum ada penyesuaian stok" />}
      />
      {open && <AdjustmentDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function AdjustmentDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const a = useAdjustment(id).data;
  const canCost = useCan('cost.read');
  const head = 'text-muted-foreground h-10 px-3 text-sm font-medium';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-xl">{a?.number ?? '…'}</DialogTitle>
          {a && (
            <DialogDescription className="text-base">
              {ADJUSTMENT_REASON[a.reasonCode].label} · {formatDateTime(a.trxAt)}
              {a.note && ` · ${a.note}`}
            </DialogDescription>
          )}
        </DialogHeader>
        {a?.lines && (
          <div className="overflow-hidden rounded-lg border">
            <Table className="text-base">
              <TableHeader>
                <TableRow className="bg-surface-muted hover:bg-surface-muted">
                  <TableHead className={head}>Barang</TableHead>
                  <TableHead className={cn(head, 'text-right')}>Jumlah</TableHead>
                  {canCost && <TableHead className={cn(head, 'text-right')}>HPP</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {a.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="px-3">
                      <p className="font-medium">{l.name}</p>
                      <p className="text-muted-foreground font-mono text-sm">{l.sku}</p>
                    </TableCell>
                    <TableCell
                      className={cn(
                        'px-3 text-right tabular-nums',
                        l.qty.startsWith('-') ? 'text-error-ink' : 'text-success-ink',
                      )}
                    >
                      {l.qty.startsWith('-') ? '' : '+'}
                      {formatNumber(l.qty)} {l.baseUnitCode.toLowerCase()}
                    </TableCell>
                    {canCost && (
                      <TableCell className="px-3 text-right tabular-nums">{formatRupiah(l.unitCost)}</TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
