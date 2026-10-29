// F9 Bayar (FR-POS-10/11/14, sprint-6 C1). Keyboard: type the cash handed over (empty + Enter =
// exact amount, the most common case), Alt+1…9 pick a payment method, Alt+N "diambil nanti", Enter
// finishes. 423 → Owner PIN → retried automatically with the same Idempotency-Key.
import { Banknote, Check, Landmark, Loader2, PackageOpen, Plus, QrCode, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { dec, Decimal } from '@shared/money';
import type { Permission } from '@shared/permissions';
import type { PaymentMethod } from '@shared/schemas/master';
import type { CompleteSaleInput, Sale } from '@shared/schemas/sales';
import { AuthorizeDialog } from '@/components/shared/AuthorizeDialog';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { Notice } from '@/components/shared/Notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';
import { cn } from '@/lib/utils';
import { completeSale, usePaymentMethods } from './api';
import { focusScan } from './focus';
import { cartTotals, usePosStore } from './store';

interface Row {
  methodId: string;
  amount: string;
  reference: string;
}

const ICONS = { CASH: Banknote, TRANSFER: Landmark, QRIS: QrCode, CREDIT: Banknote } as const;

/** Notes a customer is likely to hand over for this amount: exact, then round-ups. */
export function quickAmounts(due: string): string[] {
  const d = dec(due);
  if (d.lte(0)) return [];
  const up = (step: number) => d.div(step).ceil().times(step);
  const set = new Set<string>([d.toFixed(0)]);
  for (const step of [10_000, 50_000, 100_000]) set.add(up(step).toFixed(0));
  for (const note of [50_000, 100_000]) if (d.lt(note)) set.add(String(note));
  return [...set]
    .map((v) => dec(v))
    .sort((a, b) => a.comparedTo(b))
    .slice(0, 5)
    .map((v) => v.toFixed(0));
}

export function PaymentDialog({
  total,
  onDone,
  onClose,
}: {
  total: string;
  onDone: (sale: Sale) => void;
  onClose: () => void;
}) {
  const methods = usePaymentMethods();
  const list = methods.data ?? [];
  const cash = list.find((m) => m.kind === 'CASH');
  const channel = usePosStore((x) => x.channel);
  const customer = usePosStore((x) => x.customer);
  const pickupLater = usePosStore((x) => x.pickupLater);
  const setPickupLater = usePosStore((x) => x.setPickupLater);
  const [rows, setRows] = useState<Row[]>([]);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approval, setApproval] = useState<{ permission: Permission; reason: string } | null>(null);
  // One key per checkout (S6-8): a retry after a network error never sells twice.
  const idempotencyKey = useRef(crypto.randomUUID()).current;
  const amountInput = useRef<HTMLInputElement>(null);
  const completed = useRef(false);

  // The first row is cash as soon as the methods are known.
  const effectiveRows = rows.length ? rows : cash ? [{ methodId: cash.id, amount: '', reference: '' }] : [];
  const byId = new Map(list.map((m) => [m.id, m]));
  const kindOf = (r: Row) => byId.get(r.methodId)?.kind ?? 'CASH';

  const paidOf = (rs: Row[]) => rs.reduce((sum, r) => sum.plus(r.amount || '0'), new Decimal(0));
  const otherRowsPaid = paidOf(effectiveRows.filter((_, i) => i !== active));
  const dueForActive = Decimal.max(0, dec(total).minus(otherRowsPaid)).toFixed(0);
  const paid = paidOf(effectiveRows);
  const cashPaid = paidOf(effectiveRows.filter((r) => kindOf(r) === 'CASH'));
  const nonCash = paid.minus(cashPaid);
  const change = Decimal.max(0, paid.minus(total));
  const short = Decimal.max(0, dec(total).minus(paid));
  const nonCashTooMuch = nonCash.gt(total);
  const named = customer !== null;
  const canFinish = !busy && !nonCashTooMuch && (channel === 'FAKTUR' ? named : short.isZero());

  const update = (i: number, patch: Partial<Row>) =>
    setRows(effectiveRows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const pickMethod = (m: PaymentMethod) => {
    update(active, { methodId: m.id, reference: m.kind === 'CASH' ? '' : (effectiveRows[active]?.reference ?? '') });
    amountInput.current?.focus();
  };

  const addRow = () => {
    const next = list.find((m) => m.kind !== 'CASH') ?? cash!;
    setRows([...effectiveRows, { methodId: next.id, amount: short.gt(0) ? short.toFixed(0) : '', reference: '' }]);
    setActive(effectiveRows.length);
  };

  const finish = async (grant?: string, rowsNow = effectiveRows) => {
    setBusy(true);
    setError(null);
    const st = usePosStore.getState();
    const input: CompleteSaleInput = {
      channel: st.channel,
      customerId: st.customer?.id ?? null,
      lines: st.lines.map((l) => ({ productUnitId: l.unitId, qty: l.qty, unitPrice: l.unitPrice })),
      discountAmount: cartTotals(st.lines, st.totalTarget).discount,
      otherCharges: st.channel === 'FAKTUR' ? st.otherCharges : '0',
      otherChargesNote: st.channel === 'FAKTUR' ? st.otherChargesNote : null,
      payments: rowsNow
        .filter((r) => r.amount && dec(r.amount).gt(0))
        .map((r) => ({ paymentMethodId: r.methodId, amount: r.amount, reference: r.reference || null })),
      pickupLater: st.pickupLater,
    };
    try {
      const sale = await completeSale(input, { idempotencyKey, grant });
      completed.current = true;
      onDone(sale);
    } catch (err) {
      if (err instanceof ApiError && err.status === 423) {
        const d = err.details as { permission?: Permission } | undefined;
        setApproval({ permission: d?.permission ?? 'sales.sell_below_cost', reason: err.message });
      } else {
        setError(err instanceof ApiError ? err.message : 'Gagal menyimpan transaksi. Coba lagi.');
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    // Empty cash + Enter on a cashier sale = exact amount (most notes in the store's iPOS data).
    const r = effectiveRows[active];
    if (r && !r.amount && channel === 'KASIR') {
      const filled = effectiveRows.map((x, i) => (i === active ? { ...x, amount: dueForActive } : x));
      setRows(filled);
      void finish(undefined, filled);
      return;
    }
    if (canFinish) void finish();
  };

  const row = effectiveRows[active];
  const rowKind = row ? kindOf(row) : 'CASH';

  return (
    <>
      <Dialog open={!approval} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent
          className="sm:max-w-3xl"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            // After a successful sale the next dialog ("Transaksi selesai") owns the focus.
            if (!completed.current) focusScan();
          }}
          onKeyDown={(e) => {
            if (e.altKey && e.key.toLowerCase() === 'n' && named) {
              e.preventDefault();
              setPickupLater(!pickupLater);
              return;
            }
            const n = Number(e.key);
            if (e.altKey && n >= 1 && n <= list.length) {
              e.preventDefault();
              pickMethod(list[n - 1]!);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-xl">{channel === 'FAKTUR' ? 'Bayar faktur' : 'Bayar'}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-6 md:grid-cols-[1fr_280px]">
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cara bayar">
                {list.map((m, i) => {
                  const Icon = ICONS[m.kind];
                  const on = row?.methodId === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => pickMethod(m)}
                      className={cn(
                        'flex h-12 items-center gap-2 rounded-lg border px-4 text-base',
                        on
                          ? 'border-primary bg-primary text-primary-foreground font-semibold shadow-xs'
                          : 'hover:border-primary/60',
                      )}
                    >
                      <Icon className="size-5" /> {m.name}
                      <kbd className={cn('text-xs', on ? 'opacity-80' : 'text-muted-foreground')}>Alt+{i + 1}</kbd>
                    </button>
                  );
                })}
              </div>

              {effectiveRows.length > 1 && (
                <ul className="space-y-1">
                  {effectiveRows.map((r, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => setActive(i)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-md border px-3 py-2',
                          i === active ? 'border-primary' : 'border-transparent bg-surface-muted',
                        )}
                      >
                        <span>{byId.get(r.methodId)?.name}</span>
                        <span className="flex items-center gap-3 tabular-nums">
                          {r.amount ? formatRupiah(r.amount) : '—'}
                          <X
                            className="text-muted-foreground size-4"
                            aria-label="Hapus"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRows(effectiveRows.filter((_, j) => j !== i));
                              setActive(0);
                            }}
                          />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <label className="block space-y-2">
                <span className="text-base font-medium">
                  {rowKind === 'CASH' ? 'Uang diterima' : `Jumlah ${byId.get(row?.methodId ?? '')?.name ?? ''}`}
                </span>
                <MoneyInput
                  ref={amountInput}
                  autoFocus
                  value={row?.amount ?? ''}
                  onChange={(v) => update(active, { amount: v })}
                  placeholder={channel === 'KASIR' ? 'kosong + Enter = uang pas' : '0'}
                  className="h-16 pl-14 text-3xl md:text-3xl"
                />
              </label>
              {rowKind === 'CASH' ? (
                <div className="flex flex-wrap gap-2">
                  {quickAmounts(dueForActive).map((v, i) => (
                    <Button
                      key={v}
                      type="button"
                      variant="outline"
                      className="h-11 text-base"
                      onClick={() => update(active, { amount: v })}
                    >
                      {i === 0 ? `Uang pas ${formatRupiah(v)}` : formatRupiah(v)}
                    </Button>
                  ))}
                </div>
              ) : (
                <Input
                  value={row?.reference ?? ''}
                  onChange={(e) => update(active, { reference: e.target.value })}
                  placeholder="No. referensi / nama pengirim (boleh kosong)"
                  className="h-11 text-base md:text-base"
                />
              )}
              {list.length > 1 && (
                <Button type="button" variant="ghost" onClick={addRow}>
                  <Plus /> Bayar campur (mis. sebagian transfer)
                </Button>
              )}
              {error && <Notice tone="error">{error}</Notice>}
              {/* hidden submit so Enter in any field finishes */}
              <button type="submit" hidden />
            </form>

            <aside className="bg-surface-muted flex flex-col gap-3 rounded-xl border p-4">
              <div>
                <p className="text-muted-foreground">Total</p>
                <p className="text-right text-3xl font-bold tabular-nums">{formatRupiah(total)}</p>
              </div>
              <div className="flex justify-between text-lg">
                <span className="text-muted-foreground">Dibayar</span>
                <span className="tabular-nums">{formatRupiah(paid.toFixed(2))}</span>
              </div>
              {nonCashTooMuch ? (
                <Notice tone="error">Transfer/QRIS melebihi total. Kembalian hanya dari uang tunai.</Notice>
              ) : short.gt(0) && channel === 'FAKTUR' ? (
                <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
                  <p className="text-warning-ink">Sisa jadi piutang</p>
                  <p className="text-right text-2xl font-bold tabular-nums">{formatRupiah(short.toFixed(2))}</p>
                  <p className="text-muted-foreground text-sm">Jatuh tempo mengikuti termin pelanggan.</p>
                </div>
              ) : short.gt(0) ? (
                <div>
                  <p className="text-error-ink">Kurang</p>
                  <p className="text-error-ink text-right text-3xl font-bold tabular-nums">
                    {formatRupiah(short.toFixed(2))}
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-success-ink">Kembalian</p>
                  <p className="text-success-ink text-right text-5xl font-bold tabular-nums">
                    {formatRupiah(change.toFixed(2))}
                  </p>
                </div>
              )}

              {named ? (
                <label
                  className={cn(
                    'mt-auto flex cursor-pointer items-start gap-3 rounded-lg border bg-background p-3',
                    pickupLater && 'border-primary',
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-1 size-5 accent-[var(--color-primary)]"
                    checked={pickupLater}
                    onChange={(e) => setPickupLater(e.target.checked)}
                  />
                  <span>
                    <span className="flex items-center gap-2 font-medium">
                      <PackageOpen className="size-4" /> Barang diambil nanti <kbd className="text-xs">Alt+N</kbd>
                    </span>
                    <span className="text-muted-foreground text-sm">
                      Stok gudang baru berkurang saat barang diambil.
                    </span>
                  </span>
                </label>
              ) : (
                <span className="mt-auto" />
              )}
              {channel === 'FAKTUR' && !named && <Notice tone="warning">Faktur wajib atas nama pelanggan (F8).</Notice>}

              <Button
                size="lg"
                className="h-14 text-lg"
                disabled={busy || (channel === 'FAKTUR' && !named) || nonCashTooMuch}
                onClick={submit}
              >
                {busy ? <Loader2 className="animate-spin" /> : <Check className="size-5" />} Selesai
                <kbd className="ml-1 text-xs opacity-70">Enter</kbd>
              </Button>
            </aside>
          </div>
        </DialogContent>
      </Dialog>

      {approval && (
        <AuthorizeDialog
          permission={approval.permission}
          reason={approval.reason}
          onCancel={() => setApproval(null)}
          onGranted={(grant) => {
            setApproval(null);
            void finish(grant);
          }}
        />
      )}
    </>
  );
}
