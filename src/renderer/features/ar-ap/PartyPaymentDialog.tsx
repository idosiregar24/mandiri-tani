// Receive a receivable payment (BP) or pay a supplier (BH) — FR-ARAP-02/03, sprint-9 B1–B3.
// Default: the money goes to the oldest due notes first; ticking notes limits it to those.
// Keyboard: the amount field has focus, Enter saves, Alt+1…9 picks the payment method.
import { Banknote, Check, CheckCircle2, Landmark, Loader2, Printer, QrCode } from 'lucide-react';
import { useState } from 'react';
import { allocateOldestFirst, byOldestDue } from '@shared/ar-ap';
import { dec, Decimal } from '@shared/money';
import type { PartyPayment } from '@shared/schemas/ar-ap';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { Notice } from '@/components/shared/Notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { usePaymentMethods, useReceiptSettings } from '@/features/pos/api';
import { Chip } from '@/features/pos/layout';
import { ApiError } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';
import { cn } from '@/lib/utils';
import { uuidv7 } from '@shared/uuid';
import { SIDE, type Side, useOpenDocs, usePay } from './api';
import { printPayment } from './print';

const ICONS = { CASH: Banknote, TRANSFER: Landmark, QRIS: QrCode, CREDIT: Banknote } as const;
const date = (iso: string) => iso.split('-').reverse().join('/');

function Late({ days }: { days: number }) {
  if (days > 0) return <span className="text-error-ink text-sm font-medium">lewat {days} hari</span>;
  if (days === 0) return <span className="text-warning-ink text-sm font-medium">jatuh tempo hari ini</span>;
  return <span className="text-muted-foreground text-sm">{-days} hari lagi</span>;
}

export function PartyPaymentDialog({
  side,
  party,
  onClose,
  onCloseAutoFocus,
}: {
  side: Side;
  party: { id: string; name: string };
  onClose: () => void;
  /** The cashier screen sends focus back to the scan box. */
  onCloseAutoFocus?: () => void;
}) {
  const words = SIDE[side];
  const docsQuery = useOpenDocs(side, party.id);
  const docs = byOldestDue(docsQuery.data ?? []);
  const methods = usePaymentMethods().data ?? [];
  const [methodId, setMethodId] = useState<string | null>(null);
  const method = methods.find((m) => m.id === methodId) ?? methods.find((m) => m.kind === 'CASH') ?? methods[0];
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [key] = useState(() => uuidv7());
  const [done, setDone] = useState<PartyPayment | null>(null);
  const pay = usePay(side);

  const scope = picked.size ? docs.filter((d) => picked.has(d.id)) : docs;
  const openAll = docs.reduce((s, d) => s.plus(d.open), new Decimal(0));
  const openScope = scope.reduce((s, d) => s.plus(d.open), new Decimal(0));
  const amountOk = amount !== '' && dec(amount).gt(0) && dec(amount).lte(openScope);
  const preview = amountOk ? allocateOldestFirst(scope, amount) : [];
  const share = new Map(preview.map((a) => [a.documentId, a.amount]));

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
    // Ticking notes = "pay these": the amount follows their total.
    const sel = docs.filter((d) => next.has(d.id));
    setAmount(sel.length ? sel.reduce((s, d) => s.plus(d.open), new Decimal(0)).toFixed(0) : '');
  };

  const submit = () => {
    if (!amountOk || !method || pay.isPending) return;
    pay.mutate(
      {
        input: {
          partyId: party.id,
          paymentMethodId: method.id,
          amount,
          allocations: picked.size ? preview : null,
          reference: reference.trim() || null,
          note: note.trim() || null,
        },
        key,
      },
      { onSuccess: setDone },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-4xl"
        onCloseAutoFocus={(e) => {
          if (!onCloseAutoFocus) return;
          e.preventDefault();
          onCloseAutoFocus();
        }}
        onKeyDown={(e) => {
          if (done || !e.altKey || !/^[1-9]$/.test(e.key)) return;
          const m = methods[Number(e.key) - 1];
          if (m) {
            e.preventDefault();
            setMethodId(m.id);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-xl">
            {words.pay} — {party.name}
          </DialogTitle>
          <DialogDescription className="text-base">
            {done
              ? 'Pembayaran tersimpan.'
              : 'Uang dipakai untuk nota jatuh tempo terlama dulu. Centang nota bila pelanggan ingin melunasi nota tertentu.'}
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <PaymentDone side={side} payment={done} onClose={onClose} />
        ) : (
          <form
            className="grid gap-6 md:grid-cols-[1fr_300px]"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="space-y-4">
              <div className="max-h-[45vh] overflow-y-auto rounded-lg border">
                {docsQuery.isPending ? (
                  <p className="text-muted-foreground flex items-center gap-2 p-4">
                    <Loader2 className="size-4 animate-spin" /> Memuat…
                  </p>
                ) : docs.length === 0 ? (
                  <p className="text-muted-foreground p-4">Tidak ada {words.open.toLowerCase()} yang belum lunas.</p>
                ) : (
                  <ul>
                    {docs.map((d) => (
                      <li key={d.id} className="border-b last:border-b-0">
                        <label
                          className={cn(
                            'flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2',
                            picked.has(d.id) && 'bg-tani-green-light',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="accent-primary size-5"
                            checked={picked.has(d.id)}
                            onChange={() => toggle(d.id)}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-mono font-medium">{d.docNumber}</p>
                            <p className="text-sm">
                              <span className="text-muted-foreground">
                                {date(d.docDate)} · jatuh tempo {date(d.dueDate)} ·{' '}
                              </span>
                              <Late days={d.daysOverdue} />
                            </p>
                          </div>
                          <div className="text-right tabular-nums">
                            <p className="font-semibold">{formatRupiah(d.open)}</p>
                            {share.get(d.id) && (
                              <p className="text-success-ink text-sm">dibayar {formatRupiah(share.get(d.id)!)}</p>
                            )}
                          </div>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cara bayar">
                {methods.map((m, i) => {
                  const Icon = ICONS[m.kind];
                  return (
                    <Chip key={m.id} selected={m.id === method?.id} onClick={() => setMethodId(m.id)}>
                      <Icon className="size-4" /> {m.name}
                      <kbd className="text-xs opacity-70">Alt+{i + 1}</kbd>
                    </Chip>
                  );
                })}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-sm font-medium">No. referensi / bukti transfer</span>
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} className="h-11" />
                </label>
                <label className="space-y-1.5">
                  <span className="text-sm font-medium">Catatan</span>
                  <Input value={note} onChange={(e) => setNote(e.target.value)} className="h-11" />
                </label>
              </div>
            </div>

            <div className="bg-surface-muted flex flex-col gap-4 rounded-lg border p-4">
              <div>
                <p className="text-muted-foreground text-sm">Sisa {words.open.toLowerCase()}</p>
                <p className="text-2xl font-bold tabular-nums">{formatRupiah(openAll.toFixed(2))}</p>
              </div>
              <label className="space-y-1.5">
                <span className="font-medium">Jumlah dibayar</span>
                <MoneyInput
                  autoFocus
                  value={amount}
                  onChange={setAmount}
                  className="h-14 text-2xl font-semibold md:text-2xl"
                  aria-label="Jumlah dibayar"
                />
              </label>
              <Button
                type="button"
                variant="outline"
                className="h-10"
                disabled={openScope.lte(0)}
                onClick={() => setAmount(openScope.toFixed(0))}
              >
                {picked.size ? 'Lunasi nota dicentang' : 'Lunasi semua'} {formatRupiah(openScope.toFixed(2))}
              </Button>
              {amount !== '' && !amountOk && dec(amount).gt(openScope) && (
                <Notice tone="error">Jumlah melebihi sisa {formatRupiah(openScope.toFixed(2))}.</Notice>
              )}
              {pay.error && (
                <Notice tone="error">
                  {pay.error instanceof ApiError ? pay.error.message : 'Gagal menyimpan pembayaran.'}
                </Notice>
              )}
              <div className="mt-auto space-y-1">
                <div className="flex justify-between text-base">
                  <span className="text-muted-foreground">Sisa setelah bayar</span>
                  <span className="font-semibold tabular-nums">
                    {formatRupiah(openAll.minus(amountOk ? amount : 0).toFixed(2))}
                  </span>
                </div>
              </div>
              <Button type="submit" size="lg" className="h-12 text-base" disabled={!amountOk || pay.isPending}>
                {pay.isPending ? <Loader2 className="animate-spin" /> : <Check />} Simpan pembayaran
                <kbd className="text-xs opacity-70">Enter</kbd>
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PaymentDone({ side, payment, onClose }: { side: Side; payment: PartyPayment; onClose: () => void }) {
  const store = useReceiptSettings().data?.store;
  const [print, setPrint] = useState<{ ok: boolean; message?: string } | 'printing' | null>(null);
  const run = async (copy: boolean) => {
    if (!store) return;
    setPrint('printing');
    const r = await printPayment(payment, store, { copy });
    setPrint(r.ok ? { ok: true } : { ok: false, message: r.message });
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <CheckCircle2 className="text-success-ink size-8" />
        <div>
          <p className="font-mono text-lg font-semibold">{payment.number}</p>
          <p className="text-muted-foreground">
            {formatRupiah(payment.amount)} · {payment.method.name}
          </p>
        </div>
      </div>
      <ul className="rounded-lg border">
        {payment.allocations.map((a) => (
          <li key={a.documentId} className="flex items-center justify-between border-b px-4 py-2 last:border-b-0">
            <span className="font-mono">{a.docNumber}</span>
            <span className="tabular-nums">
              {formatRupiah(a.amount)}
              <span className="text-muted-foreground ml-3 text-sm">
                {dec(a.remaining).eq(0) ? 'lunas' : `sisa ${formatRupiah(a.remaining)}`}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-lg">
        Sisa {SIDE[side].open.toLowerCase()} sekarang:{' '}
        <span className="font-bold tabular-nums">{formatRupiah(payment.openAfter)}</span>
      </p>
      {print === 'printing' && (
        <p className="text-muted-foreground flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Mencetak…
        </p>
      )}
      {print && print !== 'printing' && !print.ok && <Notice tone="warning">{print.message}</Notice>}
      {print && print !== 'printing' && print.ok && <p className="text-success-ink">Bukti bayar tercetak.</p>}
      <div className="flex justify-end gap-2">
        {side === 'AR' && (
          <Button variant="outline" className="h-11" disabled={!store} onClick={() => void run(print !== null)}>
            <Printer /> Cetak bukti bayar
          </Button>
        )}
        <Button autoFocus className="h-11 px-6" onClick={onClose}>
          Selesai
        </Button>
      </div>
    </div>
  );
}
