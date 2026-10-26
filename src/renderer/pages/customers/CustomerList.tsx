// Customers (Sprint 3 D3): searchable list + a short form in a dialog.
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { Loader2, MoreHorizontal, Plus, Save, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { CustomerInput, type Customer } from '@shared/schemas/master';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { Notice } from '@/components/shared/Notice';
import { PageHeader } from '@/components/shared/PageHeader';
import { SearchBox } from '@/components/shared/SearchBox';
import { Badge } from '@/components/ui/badge';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useCustomerGroups } from '@/features/masters/api';
import { usePartners, useRemovePartner, useSavePartner } from '@/features/partners/api';
import { formatRupiah } from '@/lib/format';
import { applyServerErrors } from '@/lib/form-errors';
import { useDebouncedValue } from '@/lib/hooks';
import { useCan } from '@/lib/session';

type FormIn = z.input<typeof CustomerInput>;
type FormOut = z.output<typeof CustomerInput>;
const inputClass = 'h-11 text-base md:text-base';
const ALL = 'all';

const columns: ColumnDef<Customer, unknown>[] = [
  { header: 'Kode', accessorKey: 'code', meta: { className: 'w-28 font-mono text-sm' } },
  {
    header: 'Nama',
    cell: ({ row }) => (
      <span className="font-medium">
        {row.original.name}
        {row.original.isWalkIn && (
          <Badge variant="secondary" className="ml-2 text-sm">
            Bawaan
          </Badge>
        )}
        {!row.original.isActive && (
          <Badge variant="outline" className="ml-2 text-sm">
            Nonaktif
          </Badge>
        )}
      </span>
    ),
  },
  { header: 'No. HP', cell: ({ row }) => row.original.phone ?? '—', meta: { className: 'w-40' } },
  {
    header: 'Desa / alamat',
    cell: ({ row }) => [row.original.village, row.original.address].filter(Boolean).join(' · ') || '—',
  },
  { header: 'Grup', cell: ({ row }) => row.original.customerGroupName ?? '—', meta: { className: 'w-32' } },
  {
    header: 'Limit kredit',
    cell: ({ row }) =>
      row.original.creditLimit === null
        ? 'Tanpa batas'
        : row.original.creditLimit === '0.00'
          ? 'Tunai saja'
          : formatRupiah(row.original.creditLimit),
    meta: { align: 'right', className: 'w-36' },
  },
];

export function CustomerList() {
  const canWrite = useCan('customers.write');
  const groups = useCustomerGroups();
  const [q, setQ] = useState('');
  const [groupId, setGroupId] = useState(ALL);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const search = useDebouncedValue(q.trim());
  const list = usePartners('customers', {
    q: search || undefined,
    groupId: groupId === ALL ? undefined : groupId,
    includeInactive,
    page,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pelanggan"
        description="Data pelanggan, grup harga, limit kredit, dan termin pembayaran."
        icon={Users}
        actions={
          canWrite && (
            <Button size="lg" className="h-11 text-base" onClick={() => setEditing('new')}>
              <Plus /> Tambah Pelanggan
            </Button>
          )
        }
      />
      {message && <Notice tone="success">{message}</Notice>}

      <div className="flex flex-wrap items-center gap-3">
        <SearchBox
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Cari nama, kode, no. HP, atau desa…"
          aria-label="Cari pelanggan"
        />
        <Select
          value={groupId}
          onValueChange={(v) => {
            setGroupId(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-11 w-48 text-base" aria-label="Grup">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL} className="text-base">
              Semua grup
            </SelectItem>
            {groups.data?.map((g) => (
              <SelectItem key={g.id} value={g.id} className="text-base">
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex h-11 items-center gap-2 text-base">
          <Checkbox
            checked={includeInactive}
            onCheckedChange={(v) => setIncludeInactive(v === true)}
            className="size-5"
          />
          Tampilkan yang nonaktif
        </label>
      </div>

      {list.isError && <Notice tone="error">{list.error.message}</Notice>}

      <DataTable
        columns={columns}
        data={list.data?.data ?? []}
        getRowId={(c) => c.id}
        isLoading={list.isFetching}
        onRowClick={canWrite ? (c) => setEditing(c) : undefined}
        isRowMuted={(c) => !c.isActive}
        paging={
          list.data && { page, pageSize: list.data.meta.pageSize, total: list.data.meta.total, onPageChange: setPage }
        }
        empty={<EmptyState icon={Users} title={search ? 'Pelanggan tidak ditemukan' : 'Belum ada pelanggan'} />}
      />

      {editing && (
        <CustomerDialog
          customer={editing === 'new' ? null : editing}
          onClose={(msg) => {
            setEditing(null);
            if (msg) setMessage(msg);
          }}
        />
      )}
    </div>
  );
}

function toForm(c: Customer | null): FormIn {
  return {
    code: c?.code ?? '',
    name: c?.name ?? '',
    phone: c?.phone ?? '',
    address: c?.address ?? '',
    village: c?.village ?? '',
    customerGroupId: c?.customerGroupId ?? null,
    creditLimit: c?.creditLimit ?? null,
    paymentTermDays: c?.paymentTermDays ?? 10,
    notes: c?.notes ?? '',
    isActive: c?.isActive ?? true,
  };
}

function CustomerDialog({ customer, onClose }: { customer: Customer | null; onClose: (message?: string) => void }) {
  const groups = useCustomerGroups();
  const save = useSavePartner('customers');
  const remove = useRemovePartner('customers');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(CustomerInput),
    defaultValues: toForm(customer),
  });
  const walkIn = customer?.isWalkIn ?? false;

  const onSubmit = form.handleSubmit(async (input) => {
    setError(null);
    try {
      const saved = await save.mutateAsync({ id: customer?.id, input });
      onClose(`Pelanggan "${saved.name}" tersimpan (kode ${saved.code}).`);
    } catch (err) {
      setError(applyServerErrors(form.setError, err));
    }
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <Form {...form}>
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
            <DialogHeader className="flex-row items-center justify-between gap-4 pr-8">
              <DialogTitle className="text-xl">{customer ? `Ubah ${customer.name}` : 'Tambah Pelanggan'}</DialogTitle>
              {customer && !walkIn && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" className="h-10 text-base">
                      <MoreHorizontal /> Lainnya
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem className="text-error-ink text-base" onSelect={() => setConfirmDelete(true)}>
                      <Trash2 /> Hapus pelanggan
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </DialogHeader>
            {walkIn && (
              <Notice tone="info">
                Pelanggan UMUM dipakai untuk penjualan tanpa nama. Kodenya tetap UMUM dan hanya boleh bayar tunai.
              </Notice>
            )}
            {error && <Notice tone="error">{error}</Notice>}

            <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required className="text-base">
                      Nama
                    </FormLabel>
                    <FormControl>
                      <Input {...field} autoFocus className={inputClass} />
                    </FormControl>
                    <FormMessage className="text-base" />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">No. HP</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ''}
                        inputMode="tel"
                        className={inputClass}
                        placeholder="08…"
                      />
                    </FormControl>
                    <FormMessage className="text-base" />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
              <FormField
                control={form.control}
                name="village"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Desa</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} className={inputClass} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Alamat</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} className={inputClass} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <FormField
                control={form.control}
                name="customerGroupId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Grup</FormLabel>
                    <Select value={field.value ?? ALL} onValueChange={(v) => field.onChange(v === ALL ? null : v)}>
                      <FormControl>
                        <SelectTrigger className="h-11 w-full text-base">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={ALL} className="text-base">
                          Tanpa grup
                        </SelectItem>
                        {groups.data?.map((g) => (
                          <SelectItem key={g.id} value={g.id} className="text-base">
                            {g.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="creditLimit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Limit kredit</FormLabel>
                    <FormControl>
                      <MoneyInput
                        value={field.value ?? ''}
                        onChange={(v) => field.onChange(v === '' ? null : v)}
                        onBlur={field.onBlur}
                        disabled={walkIn}
                        placeholder="Tanpa batas"
                      />
                    </FormControl>
                    <p className="text-muted-foreground text-sm">Kosong = tanpa batas, 0 = tidak boleh kredit</p>
                    <FormMessage className="text-base" />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="paymentTermDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Termin (hari)</FormLabel>
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
                    <FormMessage className="text-base" />
                  </FormItem>
                )}
              />
            </div>
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
            {!walkIn && (
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
            )}

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

      {customer && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          tone="danger"
          title={`Hapus pelanggan "${customer.name}"?`}
          description="Pelanggan tidak tampil lagi di daftar. Riwayat transaksinya tetap tersimpan."
          confirmLabel="Hapus pelanggan"
          pending={remove.isPending}
          onConfirm={() =>
            remove.mutate(customer.id, {
              onSuccess: () => onClose(`Pelanggan "${customer.name}" dihapus.`),
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
