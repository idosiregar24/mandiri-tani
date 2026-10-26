// One page, one task: a product with its units and selling prices (Sprint 3 D2).
// The first unit row is the base unit (stock is kept in it); other rows say how many base
// units they contain — e.g. KG = 1 → Rp 15.000, ZAK = 50 KG → Rp 640.000.
import { ArrowLeft, ChevronDown, Loader2, MoreHorizontal, Plus, Save, Trash2, Warehouse, X } from 'lucide-react';
import { useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch, type Control } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import type { CustomerGroup, Product, Unit } from '@shared/schemas/master';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { Notice } from '@/components/shared/Notice';
import { PageHeader } from '@/components/shared/PageHeader';
import { QtyInput } from '@/components/shared/QtyInput';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBrands, useCategories, useCustomerGroups, useUnits } from '@/features/masters/api';
import { useProduct, useRemoveProduct, useSaveProduct } from '@/features/products/api';
import {
  emptyUnit,
  fromProduct,
  newProductValues,
  serverIssues,
  toPayload,
  validate,
  type ProductFormValues,
} from '@/features/products/form';
import { ApiError } from '@/lib/api-client';
import { useCan } from '@/lib/session';
import { cn } from '@/lib/utils';

const NONE = 'none';
const inputClass = 'h-11 text-base md:text-base';

export function ProductForm() {
  const { id } = useParams();
  const product = useProduct(id);
  const units = useUnits();

  const failed = (id && product.error) || units.error;
  if (failed) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Notice tone="error">{failed.message}</Notice>
      </div>
    );
  }
  if ((id && !product.data) || !units.data) {
    return <Loader2 className="text-muted-foreground mx-auto mt-16 size-8 animate-spin" aria-label="Memuat" />;
  }
  const kg = units.data.find((u) => u.code === 'KG') ?? units.data[0];
  // Re-mount per product so the form starts from that product's values.
  return (
    <ProductFormBody key={id ?? 'new'} product={product.data ?? null} units={units.data} defaultUnitId={kg?.id ?? ''} />
  );
}

function BackLink() {
  return (
    <Link to="/barang" className="text-muted-foreground inline-flex items-center gap-2 text-base hover:underline">
      <ArrowLeft className="size-5" /> Kembali ke daftar barang
    </Link>
  );
}

function ProductFormBody({
  product,
  units,
  defaultUnitId,
}: {
  product: Product | null;
  units: Unit[];
  defaultUnitId: string;
}) {
  const navigate = useNavigate();
  const canWrite = useCan('products.write');
  const categories = useCategories();
  const brands = useBrands();
  const groups = useCustomerGroups();
  const save = useSaveProduct();
  const remove = useRemoveProduct();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);

  const form = useForm<ProductFormValues>({
    defaultValues: product ? fromProduct(product) : newProductValues(defaultUnitId),
  });
  const { fields, append, remove: removeUnit } = useFieldArray({ control: form.control, name: 'units' });
  const values = useWatch({ control: form.control });
  const baseUnitCode = units.find((u) => u.id === values.units?.[0]?.unitId)?.code ?? '';
  const unitCode = (unitId: string | undefined) => units.find((u) => u.id === unitId)?.code ?? '';

  const applyIssues = (issues: { field: string; message: string }[]) => {
    const root = issues.find((i) => i.field === 'root');
    setRootError(root?.message ?? null);
    for (const i of issues) {
      if (i.field !== 'root') form.setError(i.field as never, { message: i.message });
    }
    if (issues.some((i) => i.field.startsWith('units.') && i.field.includes('.extra.'))) setShowMore(true);
  };

  const onSubmit = form.handleSubmit(async (v) => {
    form.clearErrors();
    setRootError(null);
    const issues = validate(v);
    if (issues.length) return applyIssues(issues);
    try {
      const saved = await save.mutateAsync({ id: product?.id, input: toPayload(v) });
      void navigate('/barang', { state: { saved: `Barang "${saved.name}" tersimpan.` } });
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) applyIssues(serverIssues(v, err.fieldErrors));
      else setRootError(err instanceof Error ? err.message : 'Gagal menyimpan.');
    }
  });

  const markDefaultSale = (index: number) => {
    fields.forEach((_, i) => form.setValue(`units.${i}.isDefaultSale`, i === index, { shouldDirty: true }));
  };

  return (
    <div className="max-w-5xl space-y-5">
      <BackLink />
      <PageHeader
        title={product ? product.name : 'Tambah Barang'}
        description={product ? `Kode ${product.sku}` : 'Isi nama, satuan, dan harga jual. Kode boleh dikosongkan.'}
        actions={
          product && (
            <>
              <Button asChild variant="outline" className="h-11 text-base">
                <Link to={`/stok/${product.id}`}>
                  <Warehouse /> Kartu Stok
                </Link>
              </Button>
              {canWrite && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="h-11 text-base">
                      <MoreHorizontal /> Lainnya
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem className="text-error-ink text-base" onSelect={() => setConfirmDelete(true)}>
                      <Trash2 /> Hapus barang
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          )
        }
      />

      <Form {...form}>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-6" noValidate>
          {rootError && <Notice tone="error">{rootError}</Notice>}

          <section className="grid gap-4 md:grid-cols-[2fr_1fr_1fr]">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required className="text-base">
                    Nama barang
                  </FormLabel>
                  <FormControl>
                    <Input {...field} autoFocus className={inputClass} placeholder="mis. Pupuk Urea" />
                  </FormControl>
                  <FormMessage className="text-base" />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="sku"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">Kode barang</FormLabel>
                  <FormControl>
                    <Input {...field} className={cn(inputClass, 'uppercase')} placeholder="Otomatis bila kosong" />
                  </FormControl>
                  <FormMessage className="text-base" />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">Kategori</FormLabel>
                  <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)}>
                    <FormControl>
                      <SelectTrigger className="h-11 w-full text-base">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE} className="text-base">
                        Tanpa kategori
                      </SelectItem>
                      {categories.data?.map((c) => (
                        <SelectItem key={c.id} value={c.id} className="text-base">
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage className="text-base" />
                </FormItem>
              )}
            />
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">Satuan & harga jual</h2>
              <p className="text-muted-foreground text-base">
                Baris pertama adalah <strong>satuan dasar</strong> — stok dihitung dalam satuan ini. Satuan lain diisi
                berapa satuan dasar isinya.
              </p>
            </div>
            <div className="overflow-hidden rounded-xl border">
              <div className="bg-surface-muted text-muted-foreground grid grid-cols-[10rem_11rem_1fr_1fr_7rem_3rem] gap-3 px-3 py-2 text-base font-semibold">
                <span>Satuan</span>
                <span>Isi</span>
                <span className="text-right">Harga jual umum</span>
                <span>Barcode</span>
                <span className="text-center">Utama dijual</span>
                <span />
              </div>
              {fields.map((f, i) => (
                <div
                  key={f.id}
                  className="grid grid-cols-[10rem_11rem_1fr_1fr_7rem_3rem] items-start gap-3 border-t px-3 py-3"
                >
                  <FormField
                    control={form.control}
                    name={`units.${i}.unitId`}
                    render={({ field }) => (
                      <FormItem>
                        <Select value={field.value || undefined} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="h-11 w-full text-base" aria-label={`Satuan baris ${i + 1}`}>
                              <SelectValue placeholder="Pilih…" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {units.map((u) => (
                              <SelectItem key={u.id} value={u.id} className="text-base">
                                {u.code} — {u.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {i === 0 && <p className="text-muted-foreground text-sm">Satuan dasar</p>}
                        <FormMessage className="text-base" />
                      </FormItem>
                    )}
                  />
                  {i === 0 ? (
                    <div className="flex h-11 items-center text-base">1 (dasar)</div>
                  ) : (
                    <FormField
                      control={form.control}
                      name={`units.${i}.conversionQty`}
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <QtyInput
                              value={field.value}
                              onChange={field.onChange}
                              onBlur={field.onBlur}
                              unit={baseUnitCode}
                              aria-label={`Isi ${unitCode(values.units?.[i]?.unitId)} dalam ${baseUnitCode}`}
                            />
                          </FormControl>
                          <FormMessage className="text-base" />
                        </FormItem>
                      )}
                    />
                  )}
                  <FormField
                    control={form.control}
                    name={`units.${i}.price`}
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <MoneyInput
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            aria-label={`Harga per ${unitCode(values.units?.[i]?.unitId)}`}
                          />
                        </FormControl>
                        <FormMessage className="text-base" />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`units.${i}.barcodes`}
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input
                            {...field}
                            className={cn(inputClass, 'font-mono')}
                            placeholder="Boleh kosong"
                            aria-label={`Barcode baris ${i + 1}`}
                          />
                        </FormControl>
                        <FormMessage className="text-base" />
                      </FormItem>
                    )}
                  />
                  <div className="flex h-11 items-center justify-center">
                    <input
                      type="radio"
                      name="default-sale"
                      className="accent-primary size-5"
                      checked={values.units?.[i]?.isDefaultSale ?? false}
                      onChange={() => markDefaultSale(i)}
                      aria-label={`Jual per ${unitCode(values.units?.[i]?.unitId)} secara default`}
                    />
                  </div>
                  <div className="flex h-11 items-center">
                    {i > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11"
                        onClick={() => removeUnit(i)}
                        aria-label={`Hapus baris ${i + 1}`}
                      >
                        <X className="size-5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {fields.length < 6 && (
              <Button type="button" variant="outline" className="h-11 text-base" onClick={() => append(emptyUnit())}>
                <Plus /> Tambah satuan
              </Button>
            )}
          </section>

          <section className="rounded-xl border">
            <button
              type="button"
              className="flex h-12 w-full items-center justify-between px-4 text-left text-base font-semibold"
              onClick={() => setShowMore((s) => !s)}
              aria-expanded={showMore}
            >
              Detail lain
              <ChevronDown className={cn('size-5 transition-transform', showMore && 'rotate-180')} />
            </button>
            {showMore && (
              <div className="space-y-6 border-t p-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="brandId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-base">Merek</FormLabel>
                        <Select
                          value={field.value ?? NONE}
                          onValueChange={(v) => field.onChange(v === NONE ? null : v)}
                        >
                          <FormControl>
                            <SelectTrigger className="h-11 w-full text-base">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value={NONE} className="text-base">
                              Tanpa merek
                            </SelectItem>
                            {brands.data?.map((b) => (
                              <SelectItem key={b.id} value={b.id} className="text-base">
                                {b.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="minStock"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-base">Stok minimum</FormLabel>
                        <FormControl>
                          <QtyInput
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            unit={baseUnitCode}
                          />
                        </FormControl>
                        <FormMessage className="text-base" />
                      </FormItem>
                    )}
                  />
                  <div className="space-y-3 pt-8">
                    <CheckField
                      control={form.control}
                      name="allowDecimalQty"
                      label="Boleh dijual pecahan (mis. 2,5 kg)"
                    />
                    <CheckField control={form.control} name="isService" label="Jasa (tanpa stok)" />
                    <CheckField control={form.control} name="isActive" label="Aktif (bisa dijual)" />
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <h3 className="text-base font-semibold">Harga khusus</h3>
                    <p className="text-muted-foreground text-base">
                      Harga untuk grup pelanggan tertentu, atau harga grosir mulai jumlah tertentu.
                    </p>
                  </div>
                  {fields.map((f, i) => (
                    <SpecialPrices
                      key={f.id}
                      control={form.control}
                      index={i}
                      unitCode={unitCode(values.units?.[i]?.unitId)}
                      groups={groups.data ?? []}
                    />
                  ))}
                </div>
              </div>
            )}
          </section>

          {canWrite && (
            <div className="flex gap-3">
              <Button type="submit" size="lg" className="h-12 px-6 text-base" disabled={save.isPending}>
                {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Simpan Barang
              </Button>
              <Button asChild type="button" variant="outline" size="lg" className="h-12 text-base">
                <Link to="/barang">Batal</Link>
              </Button>
            </div>
          )}
        </form>
      </Form>

      {product && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          tone="danger"
          title={`Hapus "${product.name}"?`}
          description="Barang tidak tampil lagi di daftar dan tidak bisa dijual. Riwayat transaksinya tetap tersimpan."
          confirmLabel="Hapus barang"
          pending={remove.isPending}
          onConfirm={() =>
            remove.mutate(product.id, {
              onSuccess: () => void navigate('/barang', { state: { saved: `Barang "${product.name}" dihapus.` } }),
              onError: (err) => {
                setConfirmDelete(false);
                setRootError(err.message);
              },
            })
          }
        />
      )}
    </div>
  );
}

function CheckField({
  control,
  name,
  label,
}: {
  control: Control<ProductFormValues>;
  name: 'allowDecimalQty' | 'isService' | 'isActive';
  label: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <label className="flex items-center gap-2 text-base">
          <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} className="size-5" />
          {label}
        </label>
      )}
    />
  );
}

function SpecialPrices({
  control,
  index,
  unitCode,
  groups,
}: {
  control: Control<ProductFormValues>;
  index: number;
  unitCode: string;
  groups: CustomerGroup[];
}) {
  const { fields, append, remove } = useFieldArray({ control, name: `units.${index}.extra` });
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold">Per {unitCode || `satuan baris ${index + 1}`}</span>
        <Button
          type="button"
          variant="outline"
          className="h-10 text-base"
          onClick={() =>
            append({ customerGroupId: groups.find((g) => g.code !== 'UMUM')?.id ?? null, minQty: '1', price: '' })
          }
        >
          <Plus /> Tambah harga
        </Button>
      </div>
      {fields.length === 0 && <p className="text-muted-foreground text-base">Tidak ada harga khusus.</p>}
      {fields.map((f, j) => (
        <div key={f.id} className="grid grid-cols-[1fr_10rem_1fr_3rem] items-start gap-3 py-1">
          <FormField
            control={control}
            name={`units.${index}.extra.${j}.customerGroupId`}
            render={({ field }) => (
              <FormItem>
                <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)}>
                  <FormControl>
                    <SelectTrigger className="h-11 w-full text-base" aria-label="Grup pelanggan">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={NONE} className="text-base">
                      Semua pelanggan (grosir)
                    </SelectItem>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id} className="text-base">
                        Grup {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`units.${index}.extra.${j}.minQty`}
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <QtyInput
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    unit={unitCode}
                    aria-label="Mulai jumlah"
                  />
                </FormControl>
                <FormMessage className="text-base" />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`units.${index}.extra.${j}.price`}
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <MoneyInput
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    aria-label="Harga khusus"
                  />
                </FormControl>
                <FormMessage className="text-base" />
              </FormItem>
            )}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11"
            onClick={() => remove(j)}
            aria-label="Hapus harga khusus"
          >
            <X className="size-5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
