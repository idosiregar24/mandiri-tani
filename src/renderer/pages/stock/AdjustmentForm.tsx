// Buat penyesuaian stok (FR-INV-06): pick products, choose unit + direction + qty, give a reason.
// Validation = the shared AdjustmentInput schema; the Idempotency-Key is made once per form, so
// a retry after a network error never books the adjustment twice.
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Save, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Product, ProductListItem } from '@shared/schemas/master';
import { ADJUSTMENT_REASONS, AdjustmentInput, type AdjustmentReason } from '@shared/schemas/stock';
import { uuidv7 } from '@shared/uuid';
import { Notice } from '@/components/shared/Notice';
import { PageHeader } from '@/components/shared/PageHeader';
import { ProductPicker } from '@/components/shared/ProductPicker';
import { QtyInput } from '@/components/shared/QtyInput';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { productKeys } from '@/features/products/api';
import { useCreateAdjustment } from '@/features/stock/api';
import { apiGet } from '@/lib/api-client';
import { ADJUSTMENT_REASON } from '@/lib/status';

interface Line {
  product: Product;
  productUnitId: string;
  direction: 'out' | 'in';
  qty: string;
}

const DIRECTIONS = [
  { value: 'out', label: 'Kurangi' },
  { value: 'in', label: 'Tambah' },
] as const;

export function AdjustmentForm() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const create = useCreateAdjustment();
  const [key] = useState(() => uuidv7());
  const [reason, setReason] = useState<AdjustmentReason>('DAMAGED');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const add = async (p: ProductListItem) => {
    if (lines.some((l) => l.product.id === p.id)) return;
    const product = await qc.fetchQuery({
      queryKey: productKeys.detail(p.id),
      queryFn: () => apiGet<Product>(`/products/${p.id}`),
    });
    const unit = product.units.find((u) => u.isDefaultSale) ?? product.units[0]!;
    // Damaged / lost goods are removed; "Sampel" and "Lainnya" can go either way.
    setLines((ls) => [...ls, { product, productUnitId: unit.id, direction: 'out', qty: '' }]);
  };
  const update = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = () => {
    setError(null);
    const input = {
      reasonCode: reason,
      note: note.trim() || null,
      lines: lines.map((l) => ({
        productId: l.product.id,
        productUnitId: l.productUnitId,
        qty: l.qty && (l.direction === 'out' ? `-${l.qty}` : l.qty),
      })),
    };
    const parsed = AdjustmentInput.safeParse(input);
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
        onSuccess: (a) =>
          void navigate('/penyesuaian', {
            state: { saved: `Penyesuaian ${a.number} tersimpan — stok sudah berubah.` },
          }),
        onError: (err) => setError(err.message),
      },
    );
  };

  return (
    <div className="max-w-4xl space-y-6">
      <Link
        to="/penyesuaian"
        className="text-muted-foreground inline-flex items-center gap-2 text-base hover:underline"
      >
        <ArrowLeft className="size-5" /> Kembali
      </Link>
      <PageHeader
        title="Buat Penyesuaian Stok"
        description="Stok langsung berubah setelah disimpan. Kesalahan dikoreksi dengan penyesuaian baru."
      />
      {error && <Notice tone="error">{error}</Notice>}

      <section className="grid gap-4 md:grid-cols-[16rem_1fr]">
        <div className="space-y-1.5">
          <Label className="text-base">
            Alasan<span className="text-error-ink">*</span>
          </Label>
          <Select value={reason} onValueChange={(v) => setReason(v as AdjustmentReason)}>
            <SelectTrigger className="h-11 w-full text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ADJUSTMENT_REASONS.map((r) => (
                <SelectItem key={r} value={r} className="text-base">
                  {ADJUSTMENT_REASON[r].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-base" htmlFor="adj-note">
            Catatan{reason === 'OTHER' && <span className="text-error-ink">*</span>}
          </Label>
          <Textarea
            id="adj-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={1}
            className="min-h-11 text-base md:text-base"
            placeholder="mis. karung sobek kena hujan"
          />
          {errors.note && <p className="text-error-ink text-base">{errors.note}</p>}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Barang</h2>
        <ProductPicker onPick={(p) => void add(p)} autoFocus />
        {errors.lines && <p className="text-error-ink text-base">{errors.lines}</p>}
        {lines.length > 0 && (
          <div className="divide-y rounded-xl border">
            {lines.map((l, i) => (
              <div key={l.product.id} className="grid grid-cols-[1fr_auto_9rem_11rem_3rem] items-start gap-3 px-4 py-3">
                <div className="pt-2">
                  <p className="font-medium">{l.product.name}</p>
                  <p className="text-muted-foreground font-mono text-sm">{l.product.sku}</p>
                </div>
                <SegmentedControl
                  label={`Arah untuk ${l.product.name}`}
                  value={l.direction}
                  options={DIRECTIONS}
                  onChange={(v) => update(i, { direction: v })}
                />
                <Select value={l.productUnitId} onValueChange={(v) => update(i, { productUnitId: v })}>
                  <SelectTrigger className="h-11 w-full text-base" aria-label="Satuan">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {l.product.units.map((u) => (
                      <SelectItem key={u.id} value={u.id} className="text-base">
                        {u.unitCode}
                        {u.conversionQty !== '1' &&
                          ` (${u.conversionQty} ${l.product.units.find((x) => x.isBase)?.unitCode})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div>
                  <QtyInput
                    value={l.qty}
                    onChange={(v) => update(i, { qty: v })}
                    unit={l.product.units.find((u) => u.id === l.productUnitId)?.unitCode}
                    allowDecimal={l.product.allowDecimalQty}
                    aria-label={`Jumlah ${l.product.name}`}
                  />
                  {errors[`lines.${i}.qty`] && <p className="text-error-ink text-sm">{errors[`lines.${i}.qty`]}</p>}
                </div>
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
            ))}
          </div>
        )}
      </section>

      <div className="flex gap-3">
        <Button
          size="lg"
          className="h-12 px-6 text-base"
          onClick={save}
          disabled={create.isPending || lines.length === 0}
        >
          {create.isPending ? <Loader2 className="animate-spin" /> : <Save />} Simpan Penyesuaian
        </Button>
        <Button asChild variant="outline" size="lg" className="h-12 text-base">
          <Link to="/penyesuaian">Batal</Link>
        </Button>
      </div>
    </div>
  );
}
