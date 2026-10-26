// "Data Lain" (Sprint 3 D5): the small masters, one tab each.
import { Tags } from 'lucide-react';
import { useState } from 'react';
import {
  BankAccountInput,
  BrandInput,
  CategoryInput,
  CustomerGroupInput,
  PaymentMethodInput,
  UnitInput,
  WarehouseInput,
  type Brand,
  type CashAccount,
  type Category,
  type CustomerGroup,
  type PaymentMethod,
  type Unit,
  type Warehouse,
} from '@shared/schemas/master';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMasterList } from '@/features/masters/api';
import { MasterSection, type MasterSectionConfig } from '@/features/masters/MasterSection';
import { formatNumber } from '@/lib/format';
import { useCan } from '@/lib/session';

const count = (n: number, noun: string) => (n > 0 ? `${formatNumber(String(n))} ${noun}` : '—');
const yes = (v: boolean, label: string) => (v ? <Badge className="text-sm">{label}</Badge> : null);

const unitConfig: MasterSectionConfig<Unit> = {
  resource: 'units',
  title: 'Satuan',
  noun: 'Satuan',
  description: 'Kode satuan sama dengan iPOS (ZAK = karung, KG, BTL, LTR, …).',
  columns: [
    { header: 'Kode', accessorKey: 'code', meta: { className: 'w-32 font-mono' } },
    { header: 'Nama', accessorKey: 'name' },
    {
      header: 'Dipakai',
      cell: ({ row }) => count(row.original.productCount, 'barang'),
      meta: { align: 'right', className: 'w-40' },
    },
  ],
  schema: () => UnitInput,
  fields: () => [
    { name: 'code', label: 'Kode', kind: 'code', required: true },
    { name: 'name', label: 'Nama', kind: 'text', required: true },
  ],
  defaults: (r) => ({ code: r?.code ?? '', name: r?.name ?? '' }),
  deleteName: (r) => r.code,
};

const brandConfig: MasterSectionConfig<Brand> = {
  resource: 'brands',
  title: 'Merek',
  noun: 'Merek',
  columns: [
    { header: 'Nama', accessorKey: 'name' },
    {
      header: 'Dipakai',
      cell: ({ row }) => count(row.original.productCount, 'barang'),
      meta: { align: 'right', className: 'w-40' },
    },
  ],
  schema: () => BrandInput,
  fields: () => [{ name: 'name', label: 'Nama merek', kind: 'text', required: true }],
  defaults: (r) => ({ name: r?.name ?? '' }),
  deleteName: (r) => r.name,
};

const groupConfig: MasterSectionConfig<CustomerGroup> = {
  resource: 'customerGroups',
  title: 'Grup Pelanggan',
  noun: 'Grup',
  description: 'Grup dipakai untuk harga khusus dan saran potongan nota.',
  columns: [
    { header: 'Kode', accessorKey: 'code', meta: { className: 'w-32 font-mono' } },
    { header: 'Nama', accessorKey: 'name' },
    {
      header: 'Potongan',
      cell: ({ row }) => `${formatNumber(row.original.discountPercent)}%`,
      meta: { align: 'right', className: 'w-28' },
    },
    {
      header: 'Pelanggan',
      cell: ({ row }) => count(row.original.customerCount, 'orang'),
      meta: { align: 'right', className: 'w-36' },
    },
  ],
  schema: () => CustomerGroupInput,
  fields: (r) => [
    ...(r?.code === 'UMUM' ? [] : [{ name: 'code', label: 'Kode', kind: 'code', required: true } as const]),
    { name: 'name', label: 'Nama', kind: 'text', required: true },
    { name: 'discountPercent', label: 'Saran potongan nota (%)', kind: 'number', hint: '0 bila tidak ada' },
  ],
  defaults: (r) => ({ code: r?.code ?? '', name: r?.name ?? '', discountPercent: r?.discountPercent ?? '0' }),
  deleteName: (r) => (r.code === 'UMUM' ? null : r.name),
};

const warehouseConfig: MasterSectionConfig<Warehouse> = {
  resource: 'warehouses',
  title: 'Gudang',
  noun: 'Gudang',
  description: 'Kode gudang ikut di nomor dokumen (mis. 0001789/JL/UTM/1026).',
  columns: [
    { header: 'Kode', accessorKey: 'code', meta: { className: 'w-32 font-mono' } },
    { header: 'Nama', accessorKey: 'name' },
    {
      header: 'Status',
      cell: ({ row }) => (
        <span className="flex gap-2">
          {yes(row.original.isDefault, 'Utama')}
          {!row.original.isActive && <Badge variant="outline">Nonaktif</Badge>}
        </span>
      ),
      meta: { className: 'w-40' },
    },
  ],
  schema: () => WarehouseInput,
  fields: () => [
    { name: 'code', label: 'Kode', kind: 'code', required: true },
    { name: 'name', label: 'Nama', kind: 'text', required: true },
    { name: 'isDefault', label: 'Gudang utama', kind: 'checkbox' },
    { name: 'isActive', label: 'Aktif', kind: 'checkbox' },
  ],
  defaults: (r) => ({
    code: r?.code ?? '',
    name: r?.name ?? '',
    isDefault: r?.isDefault ?? false,
    isActive: r?.isActive ?? true,
  }),
  deleteName: (r) => (r.isDefault ? null : r.name),
};

const bankConfig: MasterSectionConfig<CashAccount> = {
  resource: 'cashAccounts',
  title: 'Rekening & Kas',
  noun: 'Rekening',
  description: 'Rekening bank tujuan transfer / QRIS. Laci kasir dan kas toko adalah bawaan.',
  columns: [
    { header: 'Kode', accessorKey: 'code', meta: { className: 'w-40 font-mono' } },
    { header: 'Nama', accessorKey: 'name' },
    {
      header: 'Jenis',
      cell: ({ row }) => ({ DRAWER: 'Laci kasir', CASH: 'Kas toko', BANK: 'Bank' })[row.original.kind],
      meta: { className: 'w-32' },
    },
  ],
  schema: () => BankAccountInput,
  fields: () => [
    { name: 'code', label: 'Kode', kind: 'code', required: true, hint: 'mis. BANK_BCA' },
    { name: 'name', label: 'Nama rekening', kind: 'text', required: true, hint: 'mis. BCA a.n. Toko' },
    { name: 'isActive', label: 'Aktif', kind: 'checkbox' },
  ],
  defaults: (r) => ({ code: r?.code ?? '', name: r?.name ?? '', isActive: r?.isActive ?? true }),
  deleteName: (r) => (r.kind === 'BANK' ? r.name : null),
};

function categoryConfig(categories: Category[]): MasterSectionConfig<Category> {
  const name = (id: string | null) => categories.find((c) => c.id === id)?.name ?? '—';
  return {
    resource: 'categories',
    title: 'Kategori',
    noun: 'Kategori',
    columns: [
      { header: 'Nama', accessorKey: 'name' },
      { header: 'Induk', cell: ({ row }) => name(row.original.parentId), meta: { className: 'w-48' } },
      {
        header: 'Dipakai',
        cell: ({ row }) => count(row.original.productCount, 'barang'),
        meta: { align: 'right', className: 'w-40' },
      },
    ],
    schema: () => CategoryInput,
    fields: (r) => [
      { name: 'name', label: 'Nama kategori', kind: 'text', required: true },
      {
        name: 'parentId',
        label: 'Induk',
        kind: 'select',
        emptyLabel: 'Tanpa induk',
        options: categories.filter((c) => c.id !== r?.id).map((c) => ({ value: c.id, label: c.name })),
      },
    ],
    defaults: (r) => ({ name: r?.name ?? '', parentId: r?.parentId ?? null }),
    deleteName: (r) => r.name,
  };
}

function methodConfig(accounts: CashAccount[]): MasterSectionConfig<PaymentMethod> {
  const banks = accounts.filter((a) => a.kind === 'BANK').map((a) => ({ value: a.id, label: a.name }));
  return {
    resource: 'paymentMethods',
    title: 'Metode Bayar',
    noun: 'Metode bayar',
    description: 'Tunai dan Piutang adalah bawaan. Transfer/QRIS masuk ke rekening bank yang dipilih.',
    columns: [
      { header: 'Nama', accessorKey: 'name' },
      {
        header: 'Jenis',
        cell: ({ row }) =>
          ({ CASH: 'Tunai', CREDIT: 'Piutang', TRANSFER: 'Transfer', QRIS: 'QRIS' })[row.original.kind],
        meta: { className: 'w-28' },
      },
      {
        header: 'Masuk ke',
        cell: ({ row }) => row.original.cashAccountName ?? (row.original.kind === 'CASH' ? 'Laci kasir' : '—'),
      },
      {
        header: 'No. rekening',
        cell: ({ row }) => row.original.accountNumber ?? '—',
        meta: { className: 'w-44 font-mono' },
      },
      { header: 'Urutan', accessorKey: 'sortOrder', meta: { align: 'right', className: 'w-24' } },
    ],
    // Built-in Tunai & Piutang: only the label and order can change (server rule, mirrored here).
    schema: (r) => (r?.isBuiltIn ? PaymentMethodInput.pick({ name: true, sortOrder: true }) : PaymentMethodInput),
    fields: (r) =>
      r?.isBuiltIn
        ? [
            { name: 'name', label: 'Nama', kind: 'text', required: true },
            { name: 'sortOrder', label: 'Urutan tampil', kind: 'number' },
          ]
        : [
            { name: 'code', label: 'Kode', kind: 'code', required: true, hint: 'mis. TRANSFER_BCA' },
            { name: 'name', label: 'Nama', kind: 'text', required: true, hint: 'mis. Transfer BCA' },
            {
              name: 'kind',
              label: 'Jenis',
              kind: 'select',
              required: true,
              options: [
                { value: 'TRANSFER', label: 'Transfer bank' },
                { value: 'QRIS', label: 'QRIS' },
              ],
            },
            {
              name: 'cashAccountId',
              label: 'Masuk ke rekening',
              kind: 'select',
              required: true,
              options: banks,
              hint: banks.length ? undefined : 'Tambahkan rekening bank dulu.',
            },
            { name: 'accountNumber', label: 'No. rekening (dicetak di faktur)', kind: 'text' },
            { name: 'accountHolder', label: 'Atas nama', kind: 'text' },
            { name: 'sortOrder', label: 'Urutan tampil', kind: 'number' },
            { name: 'isActive', label: 'Aktif', kind: 'checkbox' },
          ],
    defaults: (r) => ({
      code: r?.code ?? '',
      name: r?.name ?? '',
      kind: r?.kind === 'QRIS' ? 'QRIS' : 'TRANSFER',
      cashAccountId: r?.cashAccountId ?? banks[0]?.value ?? null,
      accountNumber: r?.accountNumber ?? '',
      accountHolder: r?.accountHolder ?? '',
      sortOrder: r?.sortOrder ?? 5,
      isActive: r?.isActive ?? true,
    }),
    deleteName: (r) => (r.isBuiltIn ? null : r.name),
  };
}

const TABS = [
  { value: 'kategori', label: 'Kategori' },
  { value: 'satuan', label: 'Satuan' },
  { value: 'grup', label: 'Grup Pelanggan' },
  { value: 'gudang', label: 'Gudang' },
  { value: 'bayar', label: 'Rekening & Metode Bayar' },
  { value: 'merek', label: 'Merek' },
] as const;

export function MasterDataPage() {
  const [tab, setTab] = useState<string>('kategori');
  const canMasters = useCan('masters.write');
  const canCustomers = useCan('customers.write');
  const canSettings = useCan('settings.write');
  const categories = useMasterList('categories');
  const accounts = useMasterList('cashAccounts');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Data Lain"
        description="Kategori, satuan, grup pelanggan, gudang, rekening, dan merek."
        icon={Tags}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="h-10 px-4 text-base">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="kategori" className="pt-4">
          <MasterSection config={categoryConfig(categories.data ?? [])} canWrite={canMasters} />
        </TabsContent>
        <TabsContent value="satuan" className="pt-4">
          <MasterSection config={unitConfig} canWrite={canMasters} />
        </TabsContent>
        <TabsContent value="grup" className="pt-4">
          <MasterSection config={groupConfig} canWrite={canCustomers} />
        </TabsContent>
        <TabsContent value="gudang" className="pt-4">
          <MasterSection config={warehouseConfig} canWrite={canMasters} />
        </TabsContent>
        <TabsContent value="bayar" className="space-y-8 pt-4">
          <MasterSection config={bankConfig} canWrite={canSettings} />
          <MasterSection config={methodConfig(accounts.data ?? [])} canWrite={canSettings} />
        </TabsContent>
        <TabsContent value="merek" className="pt-4">
          <MasterSection config={brandConfig} canWrite={canMasters} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
