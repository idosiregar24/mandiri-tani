// Pengambilan Barang /pengambilan (PRD §5.3b, sprint-7 B4): goods sold earlier leave the
// warehouse. Pick a customer (F8) or type a note number → remaining goods per sale line → qty
// taken → receiver → Simpan & cetak (F9) prints the AB proof on the LX-310 (2 copies).
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  History,
  Loader2,
  PackageCheck,
  Printer,
  Search,
  Truck,
  UserRound,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { dec } from '@shared/money';
import type { Permission } from '@shared/permissions';
import type { OutstandingLine, Pickup, PickupMethod } from '@shared/schemas/pickups';
import { AuthorizeDialog } from '@/components/shared/AuthorizeDialog';
import { Notice } from '@/components/shared/Notice';
import { QtyInput } from '@/components/shared/QtyInput';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cancelPickup, createPickup, fetchPickup, printPickup, usePickups } from '@/features/pickups/api';
import { useOutstanding, useReceiptSettings } from '@/features/pos/api';
import { CustomerDialog } from '@/features/pos/dialogs';
import { Band, Chip, Kbd, Section, SummaryItem } from '@/features/pos/layout';
import { PrintStatus, type PrintState } from '@/features/pos/SaleDoneDialog';
import type { CartCustomer } from '@/features/pos/store';
import { ApiError } from '@/lib/api-client';
import { formatNumber, formatQty } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks';
import { POS_HOTKEYS, useHotkeys } from '@/lib/hotkeys';
import { cn } from '@/lib/utils';

const inputClass = 'h-11 text-base md:text-base';
const day = (iso: string) =>
  new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short' }).format(new Date(iso));

type Dlg = 'customer' | 'history' | null;

export function PickupScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const settings = useReceiptSettings();
  const store = settings.data?.store ?? { name: 'Toko', address: null, phone: null };
  const initialCustomer = (location.state as { customerId?: string } | null)?.customerId ?? null;
  const [customer, setCustomer] = useState<CartCustomer | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(initialCustomer);
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q.trim(), 250);
  const open = useOutstanding(customerId ? { customerId } : { q: debouncedQ || undefined });
  const lines = open.data ?? [];
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [receiver, setReceiver] = useState('');
  const [phone, setPhone] = useState('');
  const [method, setMethod] = useState<PickupMethod>('PICKUP');
  const [destination, setDestination] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Pickup | null>(null);
  const [print, setPrint] = useState<PrintState | null>(null);
  const [dlg, setDlg] = useState<Dlg>(null);
  const key = useRef(crypto.randomUUID());

  // Searching by note number may find one customer: take it over.
  const owner =
    customerId ??
    (lines.length && lines.every((l) => l.customerId === lines[0]!.customerId) ? lines[0]!.customerId : null);
  const ownerName = customer?.name ?? lines.find((l) => l.customerId === owner)?.customerName ?? null;
  const chosen = lines.filter((l) => owner === l.customerId && qtys[l.saleItemId] && dec(qtys[l.saleItemId]!).gt(0));
  const tooMuch = chosen.some((l) => dec(qtys[l.saleItemId]!).gt(l.remainingQty));

  const reset = () => {
    setQtys({});
    setReceiver('');
    setPhone('');
    setVehicle('');
    setDestination('');
    setNote('');
    setMethod('PICKUP');
    setError(null);
    key.current = crypto.randomUUID();
  };

  const pickCustomer = (c: CartCustomer | null) => {
    setDlg(null);
    if (!c) return;
    setCustomer(c);
    setCustomerId(c.id);
    setQ('');
    reset();
  };

  const runPrint = async (p: Pickup, copy = false) => {
    setPrint({ state: 'printing' });
    setPrint({ state: 'done', result: await printPickup(p, store, copy) });
  };

  const save = async () => {
    if (!owner || !chosen.length || tooMuch || busy) return;
    setBusy(true);
    setError(null);
    try {
      const p = await createPickup(
        {
          customerId: owner,
          lines: chosen.map((l) => ({ saleItemId: l.saleItemId, qty: qtys[l.saleItemId]! })),
          method,
          receiverName: receiver.trim() || ownerName || '-',
          receiverPhone: phone || null,
          vehicle: vehicle || null,
          destination: method === 'DELIVERY' ? destination || null : null,
          note: note || null,
        },
        key.current,
      );
      setDone(p);
      reset();
      void qc.invalidateQueries({ queryKey: ['pickups'] });
      void qc.invalidateQueries({ queryKey: ['pos', 'products'] });
      void runPrint(p);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menyimpan pengambilan.');
    } finally {
      setBusy(false);
    }
  };

  useHotkeys(
    POS_HOTKEYS,
    {
      customer: () => setDlg('customer'),
      pay: () => void save(),
      history: () => setDlg('history'),
      help: () => undefined,
    },
    dlg === null && done === null,
  );

  return (
    <div className="bg-canvas flex h-screen gap-4 overflow-hidden p-4">
      <main className="bg-background flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border shadow-xs">
        <header className="flex items-center gap-3 px-6 pt-5 pb-4">
          <button
            type="button"
            onClick={() => navigate('/kasir')}
            className="text-muted-foreground hover:text-foreground -ml-1 rounded-md p-1"
            aria-label="Kembali ke kasir"
            title="Kembali ke kasir"
          >
            <ArrowLeft className="size-5" />
          </button>
          <h1 className="text-lg font-semibold">Pengambilan Barang</h1>
          <button
            type="button"
            onClick={() => setDlg('history')}
            className="text-primary hover:text-tani-green-dark ml-auto inline-flex items-center gap-2 text-base font-medium"
          >
            <History className="size-4" /> Riwayat pengambilan <Kbd combo="Ctrl+D" />
          </button>
        </header>

        <Section title="Cari pelanggan atau nomor nota" aside={<Kbd combo="F8" />}>
          <div className="flex gap-3">
            <Button variant="outline" className="h-12 px-4 text-base" onClick={() => setDlg('customer')}>
              <UserRound /> {ownerName ?? 'Pilih pelanggan'}
            </Button>
            <div className="relative flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2" />
              <input
                autoFocus
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setCustomerId(null);
                  setCustomer(null);
                  setQtys({});
                }}
                placeholder="atau ketik nomor nota / nama, mis. 0001790/JL"
                className="border-input bg-background focus-visible:border-primary focus-visible:ring-ring/30 h-12 w-full rounded-md border pr-4 pl-12 text-lg outline-none focus-visible:ring-4"
              />
            </div>
          </div>
        </Section>
        <Band />

        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-base font-semibold">
            Barang belum diambil <span className="text-muted-foreground font-normal">({lines.length})</span>
          </h2>
          {owner && lines.length > 0 && (
            <button
              type="button"
              className="text-primary hover:text-tani-green-dark text-sm font-medium"
              onClick={() =>
                setQtys(
                  Object.fromEntries(
                    lines.filter((l) => l.customerId === owner).map((l) => [l.saleItemId, l.remainingQty]),
                  ),
                )
              }
            >
              Ambil semua
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
          {open.isFetching && !lines.length ? (
            <p className="text-muted-foreground flex items-center gap-2 py-6">
              <Loader2 className="size-4 animate-spin" /> Memuat…
            </p>
          ) : !customerId && !debouncedQ ? (
            <Empty text="Pilih pelanggan (F8) atau ketik nomor nota untuk melihat barang yang belum diambil." />
          ) : lines.length === 0 ? (
            <Empty text="Tidak ada barang yang belum diambil." />
          ) : (
            <OutstandingTable
              lines={lines}
              owner={owner}
              qtys={qtys}
              onQty={(id, v) => setQtys((x) => ({ ...x, [id]: v }))}
              onPickCustomer={(l) => {
                setCustomerId(l.customerId);
                setCustomer({ id: l.customerId, name: l.customerName, groupId: null, groupName: null });
              }}
            />
          )}
        </div>
      </main>

      <aside className="flex w-[380px] shrink-0 flex-col gap-4">
        <div className="bg-background flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border shadow-xs">
          <h2 className="border-b px-5 py-4 text-base font-semibold">Bukti pengambilan</h2>
          <form
            className="space-y-3 overflow-y-auto px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <SummaryItem label="Pelanggan" action="Ganti" combo="F8" onAction={() => setDlg('customer')}>
              <p className="text-base font-semibold">{ownerName ?? '—'}</p>
            </SummaryItem>
            <div role="radiogroup" aria-label="Cara" className="flex gap-2">
              <Chip selected={method === 'PICKUP'} onClick={() => setMethod('PICKUP')}>
                <PackageCheck className="size-4" /> Diambil
              </Chip>
              <Chip selected={method === 'DELIVERY'} onClick={() => setMethod('DELIVERY')}>
                <Truck className="size-4" /> Diantar
              </Chip>
            </div>
            <Field label="Nama penerima">
              <Input
                value={receiver}
                onChange={(e) => setReceiver(e.target.value)}
                placeholder={ownerName ?? 'nama yang mengambil'}
                className={inputClass}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="No. HP">
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  inputMode="tel"
                  className={inputClass}
                />
              </Field>
              {method === 'DELIVERY' ? (
                <Field label="Diantar ke">
                  <Input
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder="ladang / kebun"
                    className={inputClass}
                  />
                </Field>
              ) : (
                <Field label="No. polisi">
                  <Input
                    value={vehicle}
                    onChange={(e) => setVehicle(e.target.value)}
                    placeholder="BM 1234 XY"
                    className={inputClass}
                  />
                </Field>
              )}
            </div>
            <Field label="Catatan">
              <Input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
            {tooMuch && <Notice tone="warning">Jumlah diambil melebihi sisa di nota.</Notice>}
            <button type="submit" hidden />
          </form>
          <div className="bg-surface-muted mt-auto space-y-4 border-t px-5 py-5">
            <div className="flex items-baseline justify-between">
              <span className="text-base font-medium">Barang diambil</span>
              <span className="text-3xl font-bold tabular-nums">{chosen.length} baris</span>
            </div>
            <Button
              size="lg"
              className="h-14 w-full text-lg"
              disabled={!chosen.length || tooMuch || busy || (method === 'DELIVERY' && !destination.trim())}
              onClick={() => void save()}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Printer className="size-5" />} Simpan & cetak{' '}
              <Kbd combo="F9" light />
            </Button>
          </div>
        </div>
        <div className="bg-background text-muted-foreground rounded-lg border p-5 text-sm shadow-xs">
          Stok gudang berkurang saat pengambilan disimpan. Salah input? Buka <b>Riwayat</b> lalu batalkan (PIN Owner).
        </div>
      </aside>

      {dlg === 'customer' && <CustomerDialog onClose={() => setDlg(null)} onPick={pickCustomer} />}
      {dlg === 'history' && (
        <PickupHistoryDialog customerId={owner} onClose={() => setDlg(null)} onPrint={(p) => void runPrint(p, true)} />
      )}
      {done && (
        <Dialog open onOpenChange={(o) => !o && (setDone(null), setPrint(null))}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-success-ink flex items-center gap-2 text-xl">
                <CheckCircle2 className="size-6" /> Pengambilan tersimpan
              </DialogTitle>
              <DialogDescription className="font-mono text-base">{done.number}</DialogDescription>
            </DialogHeader>
            <ul className="space-y-1">
              {done.lines.map((l) => (
                <li key={l.saleItemId} className="flex justify-between gap-3">
                  <span>{l.productName}</span>
                  <span className="tabular-nums">
                    {formatQty(l.qty, l.unitCode)} · sisa {formatNumber(l.remainingQty)}
                  </span>
                </li>
              ))}
            </ul>
            <PrintStatus status={print} onRetry={() => void runPrint(done)} />
            <div className="flex justify-end">
              <Button autoFocus className="h-11 px-6" onClick={() => (setDone(null), setPrint(null))}>
                Selesai <kbd className="ml-1 text-xs opacity-70">Enter</kbd>
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="text-muted-foreground flex flex-col items-center gap-3 py-16 text-center">
      <PackageCheck className="size-12 opacity-40" />
      <p>{text}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-muted-foreground text-sm">{label}</span>
      {children}
    </label>
  );
}

function OutstandingTable({
  lines,
  owner,
  qtys,
  onQty,
  onPickCustomer,
}: {
  lines: OutstandingLine[];
  owner: string | null;
  qtys: Record<string, string>;
  onQty: (saleItemId: string, qty: string) => void;
  onPickCustomer: (l: OutstandingLine) => void;
}) {
  return (
    <table className="w-full border-collapse text-base">
      <thead className="text-muted-foreground border-b text-sm">
        <tr>
          <th className="px-3 py-2 text-left font-normal">Nota</th>
          <th className="px-3 py-2 text-left font-normal">Barang</th>
          <th className="w-28 px-3 py-2 text-right font-normal">Sisa</th>
          <th className="w-44 px-3 py-2 text-right font-normal">Diambil</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => {
          const mine = owner === l.customerId;
          const v = qtys[l.saleItemId] ?? '';
          return (
            <tr key={l.saleItemId} className={cn('border-b', v && dec(v || '0').gt(0) && 'bg-tani-green-light')}>
              <td className="px-3 py-3 align-middle">
                <p className="font-mono text-sm font-medium">{l.saleNumber}</p>
                <p className={cn('text-sm', l.ageDays > 30 ? 'text-warning-ink font-medium' : 'text-muted-foreground')}>
                  {day(l.saleDate)} · {l.ageDays} hari
                </p>
                {!owner && (
                  <button type="button" className="text-primary text-sm" onClick={() => onPickCustomer(l)}>
                    {l.customerName}
                  </button>
                )}
              </td>
              <td className="px-3 py-3 align-middle">
                <p className="font-medium">{l.productName}</p>
                <p className="text-muted-foreground font-mono text-sm">{l.sku}</p>
              </td>
              <td className="px-3 py-3 text-right align-middle font-semibold tabular-nums">
                {formatQty(l.remainingQty, l.unitCode)}
              </td>
              <td className="px-3 py-3 align-middle">
                <div className="flex items-center justify-end gap-2">
                  <QtyInput
                    value={v}
                    onChange={(x) => onQty(l.saleItemId, x)}
                    unit={l.unitCode}
                    allowDecimal={l.allowDecimalQty}
                    disabled={!mine}
                    className="h-10 w-28 text-right"
                    aria-label={`Jumlah diambil ${l.productName}`}
                  />
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function PickupHistoryDialog({
  customerId,
  onClose,
  onPrint,
}: {
  customerId: string | null;
  onClose: () => void;
  onPrint: (p: Pickup) => void;
}) {
  const qc = useQueryClient();
  const list = usePickups(customerId);
  const rows = list.data?.data ?? [];
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [approval, setApproval] = useState<Permission | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const doCancel = async (grant?: string) => {
    if (!cancelling) return;
    try {
      const p = await cancelPickup(cancelling, reason.trim(), grant);
      setMessage({
        tone: 'success',
        text: `Pengambilan ${p.number} dibatalkan. Barang kembali ke gudang dan masuk daftar belum diambil.`,
      });
      setCancelling(null);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['pickups'] });
    } catch (err) {
      if (err instanceof ApiError && err.status === 423) setApproval('pickups.cancel');
      else setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'Gagal membatalkan.' });
    }
  };

  if (approval) {
    return (
      <AuthorizeDialog
        permission={approval}
        reason="Membatalkan pengambilan butuh PIN Owner."
        onCancel={() => setApproval(null)}
        onGranted={(g) => {
          setApproval(null);
          void doCancel(g);
        }}
      />
    );
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Riwayat pengambilan</DialogTitle>
          <DialogDescription className="text-base">
            {customerId ? 'Pelanggan terpilih' : 'Semua pelanggan'} · terbaru di atas
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-[50vh] overflow-y-auto rounded-lg border">
          {rows.length === 0 && <li className="text-muted-foreground p-4">Belum ada pengambilan.</li>}
          {rows.map((r) => (
            <li key={r.id} className="flex min-h-14 items-center gap-3 border-b px-4 py-2 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className={cn('font-mono font-medium', r.status === 'CANCELLED' && 'line-through')}>{r.number}</p>
                <p className="text-muted-foreground text-sm">
                  {day(r.pickedUpAt)} · {r.customerName} · diterima {r.receiverName} · {r.itemCount} barang
                  {r.status === 'CANCELLED' && <span className="text-error-ink ml-2 font-medium">DIBATALKAN</span>}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={async () => onPrint(await fetchPickup(r.id))}
              >
                <Printer /> Cetak
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-error-ink h-9"
                disabled={r.status === 'CANCELLED'}
                onClick={() => {
                  setCancelling(r.id);
                  setMessage(null);
                }}
              >
                <Ban /> Batal
              </Button>
            </li>
          ))}
        </ul>
        {cancelling && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim().length >= 3) void doCancel();
            }}
          >
            <Input
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Alasan pembatalan"
              className={inputClass}
            />
            <Button type="submit" variant="destructive" className="h-11" disabled={reason.trim().length < 3}>
              <Ban /> Batalkan
            </Button>
          </form>
        )}
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
      </DialogContent>
    </Dialog>
  );
}
