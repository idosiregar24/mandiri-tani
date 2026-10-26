// Suppliers (Sprint 3 D4): searchable list + a short form in a dialog.
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { Loader2, MoreHorizontal, Plus, Save, Trash2, Truck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { SupplierInput, type Supplier } from '@shared/schemas/master';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Notice } from '@/components/shared/Notice';
import { PageHeader } from '@/components/shared/PageHeader';
import { SearchBox } from '@/components/shared/SearchBox';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
import { ActivePill } from '@/components/shared/StatusPill';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { usePartners, useRemovePartner, useSavePartner } from '@/features/partners/api';
import { applyServerErrors } from '@/lib/form-errors';
import { formatNumber } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks';
import { useCan } from '@/lib/session';

type FormIn = z.input<typeof SupplierInput>;
type FormOut = z.output<typeof SupplierInput>;
const inputClass = 'h-11 text-base md:text-base';

const STATUS = [
  { value: 'active', label: 'Aktif' },
  { value: 'all', label: 'Semua' },
] as const;

const columns: ColumnDef<Supplier, unknown>[] = [
  {
    header: 'Supplier',
    cell: ({ row }) => (
      <div>
        <p className="font-medium">{row.original.name}</p>
        <p className="text-muted-foreground font-mono text-sm">{row.original.code}</p>
      </div>
    ),
  },
  { header: 'Kontak', cell: ({ row }) => row.original.contactName ?? '—' },
  { header: 'No. HP', cell: ({ row }) => row.original.phone ?? '—', meta: { className: 'w-40' } },
  {
    header: 'Termin',
    cell: ({ row }) => (row.original.paymentTermDays ? `${row.original.paymentTermDays} hari` : 'Tunai'),
    meta: { align: 'right', className: 'w-28' },
  },
  { header: 'Status', cell: ({ row }) => <ActivePill active={row.original.isActive} />, meta: { className: 'w-32' } },
];

export function SupplierList() {
  const canWrite = useCan('suppliers.write');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'active' | 'all'>('active');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const search = useDebouncedValue(q.trim());
  const list = usePartners('suppliers', { q: search || undefined, includeInactive: status === 'all', page });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier"
        count={list.data ? formatNumber(String(list.data.meta.total)) : undefined}
        description="Pemasok barang toko."
        actions={
          canWrite && (
            <Button size="lg" className="h-11 text-base" onClick={() => setEditing('new')}>
              <Plus /> Tambah Supplier
            </Button>
          )
        }
      />
      {message && <Notice tone="success">{message}</Notice>}

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="Status supplier"
          value={status}
          options={STATUS}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
        <SearchBox
          autoFocus
          className="ml-auto"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Cari nama atau kode…"
          aria-label="Cari supplier"
        />
      </div>

      {list.isError && <Notice tone="error">{list.error.message}</Notice>}

      <DataTable
        columns={columns}
        data={list.data?.data ?? []}
        getRowId={(s) => s.id}
        isLoading={list.isFetching}
        onRowClick={canWrite ? (s) => setEditing(s) : undefined}
        isRowMuted={(s) => !s.isActive}
        paging={
          list.data && { page, pageSize: list.data.meta.pageSize, total: list.data.meta.total, onPageChange: setPage }
        }
        empty={<EmptyState icon={Truck} title={search ? 'Supplier tidak ditemukan' : 'Belum ada supplier'} />}
      />

      {editing && (
        <SupplierDialog
          supplier={editing === 'new' ? null : editing}
          onClose={(msg) => {
            setEditing(null);
            if (msg) setMessage(msg);
          }}
        />
      )}
    </div>
  );
}

function SupplierDialog({ supplier, onClose }: { supplier: Supplier | null; onClose: (message?: string) => void }) {
  const save = useSavePartner('suppliers');
  const remove = useRemovePartner('suppliers');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(SupplierInput),
    defaultValues: {
      code: supplier?.code ?? '',
      name: supplier?.name ?? '',
      contactName: supplier?.contactName ?? '',
      phone: supplier?.phone ?? '',
      address: supplier?.address ?? '',
      paymentTermDays: supplier?.paymentTermDays ?? 0,
      notes: supplier?.notes ?? '',
      isActive: supplier?.isActive ?? true,
    },
  });

  const onSubmit = form.handleSubmit(async (input) => {
    setError(null);
    try {
      const saved = await save.mutateAsync({ id: supplier?.id, input });
      onClose(`Supplier "${saved.name}" tersimpan (kode ${saved.code}).`);
    } catch (err) {
      setError(applyServerErrors(form.setError, err));
    }
  });

  const text = (
    name: 'name' | 'contactName' | 'phone' | 'address',
    label: string,
    required = false,
    autoFocus = false,
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel required={required} className="text-base">
            {label}
          </FormLabel>
          <FormControl>
            <Input {...field} value={field.value ?? ''} autoFocus={autoFocus} className={inputClass} />
          </FormControl>
          <FormMessage className="text-base" />
        </FormItem>
      )}
    />
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <Form {...form}>
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
            <DialogHeader className="flex-row items-center justify-between gap-4 pr-8">
              <DialogTitle className="text-xl">{supplier ? `Ubah ${supplier.name}` : 'Tambah Supplier'}</DialogTitle>
              {supplier && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" className="h-10 text-base">
                      <MoreHorizontal /> Lainnya
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem className="text-error-ink text-base" onSelect={() => setConfirmDelete(true)}>
                      <Trash2 /> Hapus supplier
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </DialogHeader>
            {error && <Notice tone="error">{error}</Notice>}
            <div className="grid gap-4 md:grid-cols-2">
              {text('name', 'Nama', true, true)}
              {text('contactName', 'Nama kontak')}
              {text('phone', 'No. HP')}
              <FormField
                control={form.control}
                name="paymentTermDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Termin bayar (hari)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={365}
                        value={String(field.value ?? '')}
                        onChange={(e) => field.onChange(e.target.value)}
                        onBlur={field.onBlur}
                        className={inputClass}
                      />
                    </FormControl>
                    <p className="text-muted-foreground text-sm">0 = tunai</p>
                    <FormMessage className="text-base" />
                  </FormItem>
                )}
              />
            </div>
            {text('address', 'Alamat')}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">Catatan</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value ?? ''} rows={2} className="text-base md:text-base" />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <label className="flex items-center gap-2 text-base">
                  <Checkbox
                    checked={field.value ?? true}
                    onCheckedChange={(v) => field.onChange(v === true)}
                    className="size-5"
                  />
                  Aktif
                </label>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" className="h-11 text-base" onClick={() => onClose()}>
                Batal
              </Button>
              <Button type="submit" className="h-11 text-base" disabled={save.isPending}>
                {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Simpan
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
      {supplier && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          tone="danger"
          title={`Hapus supplier "${supplier.name}"?`}
          description="Supplier tidak tampil lagi di daftar. Riwayat pembeliannya tetap tersimpan."
          confirmLabel="Hapus supplier"
          pending={remove.isPending}
          onConfirm={() =>
            remove.mutate(supplier.id, {
              onSuccess: () => onClose(`Supplier "${supplier.name}" dihapus.`),
              onError: (err) => {
                setConfirmDelete(false);
                setError(err.message);
              },
            })
          }
        />
      )}
    </Dialog>
  );
}
