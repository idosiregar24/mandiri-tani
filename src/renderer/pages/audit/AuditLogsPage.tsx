import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { History, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Notice } from '@/components/shared/Notice';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatusPill } from '@/components/shared/StatusPill';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { apiGet } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';

export interface AuditLogRow {
  seq: number;
  createdAt: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  actorUsername: string | null;
  actorFullName: string | null;
  approvedByUsername: string | null;
}

const ACTION_LABELS: Record<string, { label: string; tone: 'neutral' | 'success' | 'warning' | 'error' | 'info' }> = {
  'auth.login': { label: 'Masuk (Login)', tone: 'success' },
  'auth.login_failed': { label: 'Gagal Masuk', tone: 'error' },
  'auth.locked': { label: 'Akun Terkunci', tone: 'error' },
  'auth.logout': { label: 'Keluar (Logout)', tone: 'neutral' },
  'auth.authorize': { label: 'Otorisasi PIN Owner', tone: 'warning' },
  'user.create': { label: 'Buat Pengguna', tone: 'info' },
  'user.update': { label: 'Ubah Pengguna', tone: 'info' },
  'user.activate': { label: 'Aktifkan Pengguna', tone: 'success' },
  'user.deactivate': { label: 'Nonaktifkan Pengguna', tone: 'neutral' },
  'user.pin_reset': { label: 'Atur Ulang PIN', tone: 'warning' },
  'user.password_reset': { label: 'Atur Ulang Password', tone: 'warning' },
  'settings.update': { label: 'Ubah Pengaturan Toko', tone: 'info' },
  'system.setup': { label: 'Setup Pertama Kali', tone: 'success' },
  'sale.create': { label: 'Transaksi Penjualan', tone: 'success' },
  'sale.void': { label: 'Batal Nota Penjualan', tone: 'error' },
  'stock.adjust': { label: 'Penyesuaian Stok', tone: 'warning' },
  'stock.opname': { label: 'Stok Opname', tone: 'info' },
  'ar.payment': { label: 'Pelunasan Piutang', tone: 'success' },
  'ap.payment': { label: 'Pembayaran Hutang', tone: 'neutral' },
};

export function AuditLogsPage() {
  const [detailRow, setDetailRow] = useState<AuditLogRow | null>(null);

  const query = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => apiGet<AuditLogRow[]>('/audit-logs?limit=100'),
  });

  const columns: ColumnDef<AuditLogRow, unknown>[] = [
    {
      header: 'Waktu',
      cell: ({ row }) => (
        <span className="font-mono text-xs tabular-nums text-muted-foreground whitespace-nowrap">
          {formatDateTime(row.original.createdAt)}
        </span>
      ),
    },
    {
      header: 'Pengguna',
      cell: ({ row }) => (
        <div>
          <span className="font-medium text-foreground text-sm">
            {row.original.actorFullName || row.original.actorUsername || 'Sistem'}
          </span>
          {row.original.actorUsername && (
            <span className="text-muted-foreground text-xs block font-mono">
              @{row.original.actorUsername}
            </span>
          )}
        </div>
      ),
    },
    {
      header: 'Aktivitas',
      cell: ({ row }) => {
        const item = ACTION_LABELS[row.original.action] ?? { label: row.original.action, tone: 'neutral' };
        return <StatusPill tone={item.tone}>{item.label}</StatusPill>;
      },
    },
    {
      header: 'Otorisasi',
      cell: ({ row }) =>
        row.original.approvedByUsername ? (
          <span className="inline-flex items-center gap-1 text-xs text-amber-800 bg-amber-50 px-2 py-0.5 rounded font-mono">
            <ShieldCheck className="size-3" /> @{row.original.approvedByUsername}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
    {
      header: 'Detail',
      cell: ({ row }) => {
        const hasData = row.original.before !== null || row.original.after !== null;
        if (!hasData) return <span className="text-muted-foreground text-xs">—</span>;
        return (
          <Button variant="ghost" size="sm" onClick={() => setDetailRow(row.original)} className="h-7 text-xs">
            Lihat data
          </Button>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Catatan Aktivitas (Audit Log)"
        description="Jejak audit permanen (append-only) untuk setiap perubahan penting dan riwayat masuk pengguna."
      />

      {query.isError && <Notice tone="error">{query.error.message}</Notice>}

      <DataTable
        columns={columns}
        data={query.data ?? []}
        isLoading={query.isLoading}
        getRowId={(r) => String(r.seq)}
        empty={<EmptyState icon={History} title="Belum ada catatan aktivitas." />}
      />

      {detailRow && (
        <Dialog open={true} onOpenChange={(o) => !o && setDetailRow(null)}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Detail Aktivitas: {ACTION_LABELS[detailRow.action]?.label ?? detailRow.action}</DialogTitle>
            </DialogHeader>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface-muted p-3">
                <div>
                  <span className="text-muted-foreground">Waktu:</span>{' '}
                  <span className="font-medium">{formatDateTime(detailRow.createdAt)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Pengguna:</span>{' '}
                  <span className="font-medium">
                    {detailRow.actorFullName || detailRow.actorUsername || 'Sistem'}
                  </span>
                </div>
                {detailRow.ip && (
                  <div>
                    <span className="text-muted-foreground">Alamat IP:</span>{' '}
                    <span className="font-mono">{detailRow.ip}</span>
                  </div>
                )}
                {detailRow.approvedByUsername && (
                  <div>
                    <span className="text-muted-foreground">Dilisensikan oleh:</span>{' '}
                    <span className="font-medium">@{detailRow.approvedByUsername}</span>
                  </div>
                )}
              </div>

              {detailRow.before !== null && (
                <div className="space-y-1">
                  <span className="font-semibold text-muted-foreground">Sebelum:</span>
                  <pre className="p-3 bg-surface-muted rounded-lg overflow-x-auto text-[11px] font-mono">
                    {JSON.stringify(detailRow.before, null, 2)}
                  </pre>
                </div>
              )}

              {detailRow.after !== null && (
                <div className="space-y-1">
                  <span className="font-semibold text-muted-foreground">Sesudah:</span>
                  <pre className="p-3 bg-surface-muted rounded-lg overflow-x-auto text-[11px] font-mono">
                    {JSON.stringify(detailRow.after, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

