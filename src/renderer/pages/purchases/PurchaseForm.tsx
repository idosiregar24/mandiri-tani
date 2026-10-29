// Faktur pembelian langsung BL (FR-PUR-04, sprint-8 B2). Short like the store's iPOS habit:
// supplier, date, supplier invoice no., goods (last purchase price suggested), Tunai/Transfer/
// Kredit. Discount, shipping (optionally into HPP) and note sit in the folded "Detail lain".
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Save, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { dec, Decimal } from '@shared/money';
import { lineTotal } from '@shared/pos';
import type { Product, ProductListItem } from '@shared/schemas/master';
import { PurchaseInput, type PurchasePayKind } from '@shared/schemas/purchases';
import { uuidv7 } from '@shared/uuid';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { Notice } from '@/components/shared/Notice';
import { PageHeader } from '@/components/shared/PageHeader';
import { ProductPicker } from '@/components/shared/ProductPicker';
import { QtyInput } from '@/components/shared/QtyInput';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePartners } from '@/features/partners/api';
import { usePaymentMethods, todayJakarta } from '@/features/pos/api';
import { productKeys } from '@/features/products/api';
import { priceHistory, useCreatePurchase } from '@/features/purchases/api';
import { apiGet } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';

interface Line {
  product: Product;
  productUnitId: string;
  qty: string;
  unitPrice: string;
  /** "harga beli terakhir Rp … (dd/mm)" for this unit, when known. */
  hint: string | null;
}

const PAY_KINDS = [
  { value: 'CASH', label: 'Tunai' },
  { value: 'TRANSFER', label: 'Transfer' },
  { value: 'CREDIT', label: 'Kredit (hutang)' },
] as const;

const inputClass = 'h-11 text-base md:text-base';
const addDaysIso = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export function PurchaseForm() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const create = useCreatePurchase();
  const suppliers = usePartners('suppliers', { page: 1 });
  const methods = usePaymentMethods();
  const banks = (methods.data ?? []).filter((m) => m.kind !== 'CASH');
  const [key] = useState(() => uuidv7());
  const [supplierId, setSupplierId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayJakarta());
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [payKind, setPayKind] = useState<PurchasePayKind>('CASH');
  const [bankId, setBankId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [discount, setDiscount] = useState('');
  const [otherCost, setOtherCost] = useState('');
  const [otherCostToHpp, setOtherCostToHpp] = useState(false);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const supplier = suppliers.data?.data.find((s) => s.id === supplierId);
  const defaultDue = addDaysIso(invoiceDate, supplier?.paymentTermDays || 10);
  const subtotal = lines.reduce((s, l) => s.plus(l.qty && l.unitPrice ? lineTotal(l) : '0'), new Decimal(0));
  const total = subtotal.minus(discount || '0').plus(otherCost || '0');

  const add = async (p: ProductListItem) => {
    if (lines.some((l) => l.product.id === p.id)) return;
    const product = await qc.fetchQuery({
      queryKey: productKeys.detail(p.id),
      queryFn: () => apiGet<Product>(`/products/${p.id}`),
    });
    // The store buys in big units (iPOS: 351 ZAK lines vs 15 KG): the unit of the last purchase,
    // otherwise the largest unit — never silently the base KG.
    const history = await priceHistory(p.id).catch(() => []);
    const largest = [...product.units].sort((a, b) => dec(b.conversionQty).comparedTo(a.conversionQty))[0]!;
    const unit = product.units.find((u) => u.unitCode === history[0]?.unitCode) ?? largest;
    const last = history.find((h) => h.unitCode === unit.unitCode);
    setLines((ls) => [
      ...ls,
      {
        product,
        productUnitId: unit.id,
        qty: '',
        unitPrice: last ? dec(last.unitPrice).toFixed() : '',
        hint: last
          ? `terakhir ${formatRupiah(last.unitPrice)} · ${last.supplierName} · ${last.invoiceDate.split('-').reverse().join('/')}`
          : null,
      },
    ]);
  };
  const update = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = () => {
    setError(null);
    const input = {
      supplierId,
      invoiceDate,
      supplierInvoiceNo: supplierInvoiceNo.trim() || null,
      lines: lines.map((l) => ({ productUnitId: l.productUnitId, qty: l.qty, unitPrice: l.unitPrice })),
      discountAmount: discount || '0',
      otherCost: otherCost || '0',
      otherCostToHpp,
      payKind,
      paymentMethodId: payKind === 'TRANSFER' ? bankId || null : null,
      dueDate: payKind === 'CREDIT' ? dueDate || defaultDue : null,
      note: note.trim() || null,
    };
    const parsed = PurchaseInput.safeParse(input);
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const issue of parsed.error.issues) e[issue.path.join('.')] ??= issue.message;
      setErrors(e);
      return;
    }
    setErrors({});
    create.mutate(
      { input, key },
      {
        onSuccess: (p) =>
          void navigate('/pembelian', {
            state: { saved: `Faktur ${p.number} tersimpan — stok bertambah ${p.lines.length} barang.` },
          }),
        onError: (err) => setError(err.message),
      },
    );
  };

  return (
    <div className="max-w-5xl space-y-6">
      <Link to="/pembelian" className="text-muted-foreground inline-flex items-center gap-2 text-base hover:underline">
        <ArrowLeft className="size-5" /> Kembali
      </Link>
      <PageHeader
        title="Faktur Pembelian Baru"
        description="Barang langsung masuk stok dengan harga pokok dari faktur ini."
      />
      {error && <Notice tone="error">{error}</Notice>}

      <section className="grid gap-4 md:grid-cols-3">
        <Field label="Supplier" required error={errors.supplierId}>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger className="h-11 w-full text-base">
              <SelectValue placeholder="Pilih supplier" />
            </SelectTrigger>
            <SelectContent>
              {(suppliers.data?.data ?? [])
                .filter((s) => s.isActive)
                .map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-base">
                    {s.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Tanggal faktur" required error={errors.invoiceDate}>
          <Input
            type="date"
            value={invoiceDate}
            max={todayJakarta()}
            onChange={(e) => setInvoiceDate(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="No. faktur supplier">
          <Input
            value={supplierInvoiceNo}
            onChange={(e) => setSupplierInvoiceNo(e.target.value)}
            placeholder="mis. INV/1026/0012"
            className={inputClass}
          />
        </Field>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Barang</h2>
        <ProductPicker onPick={(p) => void add(p)} />
        {errors.lines && <p className="text-error-ink text-base">{errors.lines}</p>}
        {lines.length > 0 && (
          <div className="divide-y rounded-xl border">
            {lines.map((l, i) => {
              const unit = l.product.units.find((u) => u.id === l.productUnitId);
              return (
                <div
                  key={l.product.id}
                  className="grid grid-cols-[1fr_8rem_9rem_12rem_10rem_3rem] items-start gap-3 px-4 py-3"
                >
                  <div className="pt-2">
                    <p className="font-medium">{l.product.name}</p>
                    <p className="text-muted-foreground text-sm">{l.hint ?? l.product.sku}</p>
                  </div>
                  <Select value={l.productUnitId} onValueChange={(v) => update(i, { productUnitId: v })}>
                    <SelectTrigger className="h-11 w-full text-base" aria-label="Satuan">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {l.product.units.map((u) => (
                        <SelectItem key={u.id} value={u.id} className="text-base">
                          {u.unitCode}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div>
                    <QtyInput
                      value={l.qty}
                      onChange={(v) => update(i, { qty: v })}
                      unit={unit?.unitCode}
                      allowDecimal={l.product.allowDecimalQty}
                      aria-label={`Jumlah ${l.product.name}`}
                    />
                    {errors[`lines.${i}.qty`] && <p className="text-error-ink text-sm">{errors[`lines.${i}.qty`]}</p>}
                  </div>
                  <div>
                    <MoneyInput
                      value={l.unitPrice}
                      onChange={(v) => update(i, { unitPrice: v })}
                      className="pl-10"
                      aria-label={`Harga beli ${l.product.name}`}
                    />
                    {errors[`lines.${i}.unitPrice`] && (
                      <p className="text-error-ink text-sm">{errors[`lines.${i}.unitPrice`]}</p>
                    )}
                  </div>
                  <p className="pt-2.5 text-right font-semibold tabular-nums">
                    {l.qty && l.unitPrice ? formatRupiah(lineTotal(l)) : '—'}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11"
                    onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                    aria-label={`Hapus ${l.product.name}`}
                  >
                    <X className="size-5" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid gap-6 md:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-base">Pembayaran</Label>
            <SegmentedControl label="Pembayaran" value={payKind} options={PAY_KINDS} onChange={setPayKind} />
          </div>
          {payKind === 'TRANSFER' && (
            <Field label="Dari rekening" required error={errors.paymentMethodId}>
              <Select value={bankId} onValueChange={setBankId}>
                <SelectTrigger className="h-11 w-full text-base">
                  <SelectValue placeholder="Pilih rekening" />
                </SelectTrigger>
                <SelectContent>
                  {banks.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-base">
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {payKind === 'CREDIT' && (
            <Field label="Jatuh tempo" required>
              <Input
                type="date"
                value={dueDate || defaultDue}
                min={invoiceDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={inputClass}
              />
              <p className="text-muted-foreground text-sm">
                Default: termin supplier {supplier?.paymentTermDays || 10} hari.
              </p>
            </Field>
          )}
          <details className="rounded-lg border px-4 py-3">
            <summary className="cursor-pointer text-base font-medium">Detail lain (potongan, ongkos, catatan)</summary>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Potongan faktur">
                <MoneyInput value={discount} onChange={setDiscount} className="pl-10" />
              </Field>
              <Field label="Ongkos angkut / biaya lain">
                <MoneyInput value={otherCost} onChange={setOtherCost} className="pl-10" />
                <label className="flex items-center gap-2 pt-1 text-sm">
                  <Checkbox checked={otherCostToHpp} onCheckedChange={(v) => setOtherCostToHpp(v === true)} /> Masukkan
                  ke harga pokok barang
                </label>
              </Field>
              <div className="md:col-span-2">
                <Field label="Catatan">
                  <Input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
                </Field>
              </div>
            </div>
          </details>
        </div>

        <aside className="bg-surface-muted space-y-3 rounded-xl border p-5">
          <Row label="Subtotal" value={formatRupiah(subtotal.toFixed(2))} />
          {discount && <Row label="Potongan" value={`−${formatRupiah(discount)}`} />}
          {otherCost && <Row label="Ongkos" value={`+${formatRupiah(otherCost)}`} />}
          <div className="border-t pt-3">
            <p className="text-muted-foreground">Total faktur</p>
            <p className="text-right text-3xl font-bold tabular-nums">{formatRupiah(total.toFixed(2))}</p>
          </div>
          <Button
            size="lg"
            className="h-12 w-full text-base"
            onClick={save}
            disabled={create.isPending || lines.length === 0}
          >
            {create.isPending ? <Loader2 className="animate-spin" /> : <Save />} Simpan Faktur
          </Button>
        </aside>
      </section>
    </div>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-base">
        {label}
        {required && <span className="text-error-ink">*</span>}
      </Label>
      {children}
      {error && <p className="text-error-ink text-sm">{error}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-base">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
