// One stock-opname session (FR-INV-05): find a product → choose unit → type the counted qty →
// see the difference → post. The system qty shown while counting is LIVE; the server takes it
// again at posting, so sales during the session are counted correctly.
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Loader2, MoreHorizontal, Save, Trash2, X, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { dec } from '@shared/money';
import type { Product, ProductListItem } from '@shared/schemas/master';
import type { Opname } from '@shared/schemas/stock';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Notice } from '@/components/shared/Notice';
import { PageHeader } from '@/components/shared/PageHeader';
import { ProductPicker } from '@/components/shared/ProductPicker';
import { QtyInput } from '@/components/shared/QtyInput';
import { StatusPill } from '@/components/shared/StatusPill';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { productKeys } from '@/features/products/api';
import { useCancelOpname, useCountOpname, useOpname, usePostOpname, useRemoveOpnameLine } from '@/features/stock/api';
import { apiGet } from '@/lib/api-client';
import { formatDateTime, formatNumber, formatRupiah, formatStockQty } from '@/lib/format';
import { useCan } from '@/lib/session';
import { OPNAME_STATUS } from '@/lib/status';
import { cn } from '@/lib/utils';

const head = 'text-muted-foreground h-11 px-4 text-sm font-medium';
const num = 'px-4 text-right tabular-nums';

export function OpnamePage() {
  const { id = '' } = useParams();
  const opname = useOpname(id);
  const o = opname.data;
  return (
    <div className="space-y-6">
      <Link to="/opname" className="text-muted-foreground inline-flex items-center gap-2 text-base hover:underline">
        <ArrowLeft className="size-5" /> Kembali ke daftar stok opname
      </Link>
      {opname.isError && <Notice tone="error">{opname.error.message}</Notice>}
      {o ? (
        <OpnameBody opname={o} />
      ) : (
        !opname.isError && <Loader2 className="text-muted-foreground mx-auto mt-16 size-8 animate-spin" />
      )}
    </div>
  );
}

function OpnameBody({ opname: o }: { opname: Opname }) {
  const canCost = useCan('cost.read');
  const counting = o.status === 'COUNTING';
  const post = usePostOpname(o.id);
  const cancel = useCancelOpname(o.id);
  const remove = useRemoveOpnameLine(o.id);
  const [confirm, setConfirm] = useState<'post' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = OPNAME_STATUS[o.status];
  const lines = o.lines ?? [];
  const changed = lines.filter((l) => !dec(l.diffQty).isZero()).length;

  return (
    <>
      <PageHeader
        title={o.number}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
            Mulai {formatDateTime(o.startedAt)}
            {o.postedAt && ` · diposting ${formatDateTime(o.postedAt)}`}
            {o.note && ` · ${o.note}`}
          </span>
        }
        actions={
          counting && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-11 text-base">
                    <MoreHorizontal /> Lainnya
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-error-ink h-10 text-base" onSelect={() => setConfirm('cancel')}>
                    <XCircle /> Batalkan stok opname
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="lg"
                className="h-11 text-base"
                onClick={() => setConfirm('post')}
                disabled={lines.length === 0}
              >
                <CheckCircle2 /> Posting Opname
              </Button>
            </>
          )
        }
      />
      {error && <Notice tone="error">{error}</Notice>}
      {counting && <CountForm opnameId={o.id} onError={setError} />}

      <div className="overflow-hidden rounded-xl border">
        <Table className="text-base">
          <TableHeader>
            <TableRow className="bg-surface-muted hover:bg-surface-muted">
              <TableHead className={head}>Barang</TableHead>
              <TableHead className={cn(head, 'text-right')}>Dihitung</TableHead>
              <TableHead className={cn(head, 'text-right')}>
                {counting ? 'Di aplikasi sekarang' : 'Di aplikasi saat posting'}
              </TableHead>
              <TableHead className={cn(head, 'text-right')}>Selisih</TableHead>
              {canCost && <TableHead className={cn(head, 'text-right')}>Nilai selisih</TableHead>}
              {counting && <TableHead className="w-14" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground px-4 py-8 text-center">
                  Belum ada barang yang dihitung. Cari barang di atas, isi jumlahnya, lalu simpan.
                </TableCell>
              </TableRow>
            )}
            {lines.map((l) => {
              const f = (v: string) => formatStockQty(v, l.baseUnitCode, l.saleUnitCode, l.saleConversion);
              const diff = dec(l.diffQty);
              return (
                <TableRow key={l.id} className="h-14">
                  <TableCell className="px-4">
                    <p className="font-medium">{l.name}</p>
                    <p className="text-muted-foreground font-mono text-sm">{l.sku}</p>
                  </TableCell>
                  <TableCell className={num}>{f(l.countedQty).main}</TableCell>
                  <TableCell className={num}>{f(l.systemQty).main}</TableCell>
                  <TableCell
                    className={cn(
                      num,
                      'font-medium',
                      diff.isZero()
                        ? 'text-muted-foreground'
                        : diff.isNegative()
                          ? 'text-error-ink'
                          : 'text-success-ink',
                    )}
                  >
                    {diff.isZero()
                      ? 'Cocok'
                      : `${diff.isNegative() ? '' : '+'}${formatNumber(l.diffQty)} ${l.baseUnitCode.toLowerCase()}`}
                  </TableCell>
                  {canCost && (
                    <TableCell className={cn(num, diff.isNegative() && 'text-error-ink')}>
                      {formatRupiah(l.diffValue)}
                    </TableCell>
                  )}
                  {counting && (
                    <TableCell className="px-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-10"
                        aria-label={`Hapus hitungan ${l.name}`}
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(l.id, { onError: (e) => setError(e.message) })}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {canCost && o.diffValue !== undefined && lines.length > 0 && (
        <p className="text-right text-lg">
          Total selisih:{' '}
          <span className={cn('font-semibold tabular-nums', dec(o.diffValue).isNegative() && 'text-error-ink')}>
            {formatRupiah(o.diffValue)}
          </span>
        </p>
      )}

      <ConfirmDialog
        open={confirm === 'post'}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={`Posting ${o.number}?`}
        description={`${lines.length} barang dihitung, ${changed} berbeda dengan aplikasi. Stok di aplikasi akan disamakan dengan hasil hitung. Jumlah "di aplikasi" diambil ulang saat posting.`}
        confirmLabel="Posting sekarang"
        pending={post.isPending}
        onConfirm={() =>
          post.mutate(undefined, { onSettled: () => setConfirm(null), onError: (e) => setError(e.message) })
        }
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        onOpenChange={(v) => !v && setConfirm(null)}
        tone="danger"
        title={`Batalkan ${o.number}?`}
        description="Hasil hitungan tidak dipakai dan stok tidak berubah."
        confirmLabel="Batalkan opname"
        pending={cancel.isPending}
        onConfirm={() =>
          cancel.mutate(undefined, { onSettled: () => setConfirm(null), onError: (e) => setError(e.message) })
        }
      />
    </>
  );
}

/** Pick a product, choose the unit it is counted in, type the quantity, save (Enter). */
function CountForm({ opnameId, onError }: { opnameId: string; onError: (m: string | null) => void }) {
  const qc = useQueryClient();
  const count = useCountOpname(opnameId);
  const [product, setProduct] = useState<Product | null>(null);
  const [unitId, setUnitId] = useState('');
  const [qty, setQty] = useState('');

  const pick = async (p: ProductListItem) => {
    const full = await qc.fetchQuery({
      queryKey: productKeys.detail(p.id),
      queryFn: () => apiGet<Product>(`/products/${p.id}`),
    });
    setProduct(full);
    setUnitId((full.units.find((u) => u.isDefaultSale) ?? full.units[0]!).id);
    setQty('');
  };
  const save = () => {
    if (!product || qty === '') return;
    onError(null);
    count.mutate(
      { productId: product.id, productUnitId: unitId, countedQty: qty },
      {
        onSuccess: () => {
          setProduct(null);
          setQty('');
        },
        onError: (e) => onError(e.message),
      },
    );
  };

  return (
    <section className="bg-surface-muted space-y-3 rounded-xl border p-4">
      {!product ? (
        <ProductPicker onPick={(p) => void pick(p)} autoFocus placeholder="Cari barang yang sedang dihitung…" />
      ) : (
        <form
          className="grid grid-cols-[1fr_10rem_12rem_auto_auto] items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div>
            <p className="font-medium">{product.name}</p>
            <p className="text-muted-foreground font-mono text-sm">{product.sku}</p>
          </div>
          <Select value={unitId} onValueChange={setUnitId}>
            <SelectTrigger className="bg-background h-11 w-full text-base" aria-label="Satuan hitung">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {product.units.map((u) => (
                <SelectItem key={u.id} value={u.id} className="text-base">
                  {u.unitCode}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <QtyInput
            autoFocus
            value={qty}
            onChange={setQty}
            unit={product.units.find((u) => u.id === unitId)?.unitCode}
            allowDecimal={product.allowDecimalQty}
            aria-label={`Jumlah ${product.name} yang dihitung`}
            className="bg-background"
          />
          <Button type="submit" className="h-11 text-base" disabled={count.isPending || qty === ''}>
            {count.isPending ? <Loader2 className="animate-spin" /> : <Save />} Simpan
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="Batal"
            onClick={() => setProduct(null)}
          >
            <X className="size-5" />
          </Button>
        </form>
      )}
    </section>
  );
}
