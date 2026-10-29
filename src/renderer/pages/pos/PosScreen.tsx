// Cashier screen /kasir (PRD §5.3, sprint-5 C4–C8, sprint-6 C1–C4): full screen, no sidebar.
// Top: mode (Kasir KSR / Faktur JL) + scan box; left: cart; right: customer, totals, Bayar;
// bottom: status bar. Every action works from the keyboard and gives focus back to the scan box.
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CircleHelp,
  CreditCard,
  FileText,
  History,
  Lock,
  PackageSearch,
  Pencil,
  Printer,
  Receipt,
  Ruler,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { PosProduct } from '@shared/schemas/pos';
import type { Sale, SaleChannel } from '@shared/schemas/sales';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Notice } from '@/components/shared/Notice';
import { Button } from '@/components/ui/button';
import { useLogout } from '@/features/auth/api';
import { useHealth } from '@/features/home/api';
import { lookupCode, useOutstanding, useReceiptSettings } from '@/features/pos/api';
import {
  ChargesDialog,
  CustomerDialog,
  DiscountDialog,
  HelpDialog,
  PriceDialog,
  QtyDialog,
  UnitDialog,
} from '@/features/pos/dialogs';
import { beepError, focusScan, isScanBox } from '@/features/pos/focus';
import { HeldListDialog, HoldDialog } from '@/features/pos/HeldDialogs';
import { PartyPaymentDialog } from '@/features/ar-ap/PartyPaymentDialog';
import { HistoryDialog } from '@/features/pos/HistoryDialog';
import { PaymentDialog } from '@/features/pos/PaymentDialog';
import { Band, Chip, Kbd, Pill, Row, Section, SummaryItem } from '@/features/pos/layout';
import { PosCart, type LineAction } from '@/features/pos/PosCart';
import { SaleDoneDialog } from '@/features/pos/SaleDoneDialog';
import { ScanBox } from '@/features/pos/ScanBox';
import { cartTotals, usePosStore } from '@/features/pos/store';
import { formatDateTime, formatRupiah } from '@/lib/format';
import { POS_HOTKEYS, useHotkeys, type PosAction } from '@/lib/hotkeys';
import { useScanner } from '@/lib/scanner';
import { useSessionUser } from '@/lib/session';
import { cn } from '@/lib/utils';

type DialogState =
  | { kind: LineAction | 'remove'; key: string }
  | { kind: 'discount' | 'customer' | 'help' | 'clear' | 'pay' | 'charges' | 'history' | 'hold' | 'held' }
  | { kind: 'receivable'; party: { id: string; name: string } | null }
  | { kind: 'done'; sale: Sale }
  | null;

const MODES: { value: SaleChannel; label: string; hint: string; icon: typeof Receipt }[] = [
  { value: 'KASIR', label: 'Kasir', hint: 'struk · bayar lunas', icon: Receipt },
  { value: 'FAKTUR', label: 'Faktur', hint: 'JL · kredit · ongkos angkut', icon: FileText },
];

export function PosScreen() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useSessionUser();
  const logout = useLogout();
  const settings = useReceiptSettings();
  const lines = usePosStore((s) => s.lines);
  const selectedKey = usePosStore((s) => s.selectedKey);
  const customer = usePosStore((s) => s.customer);
  const totalTarget = usePosStore((s) => s.totalTarget);
  const channel = usePosStore((s) => s.channel);
  const otherCharges = usePosStore((s) => s.otherCharges);
  const otherChargesNote = usePosStore((s) => s.otherChargesNote);
  const pickupLater = usePosStore((s) => s.pickupLater);
  const store = usePosStore.getState;
  const totals = cartTotals(lines, totalTarget, channel === 'FAKTUR' ? otherCharges : '0');
  const [dialog, setDialog] = useState<DialogState>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const faktur = channel === 'FAKTUR';
  const outstanding = useOutstanding({ customerId: customer?.id ?? null });
  const needsCustomer = faktur && !customer;

  const close = () => {
    setDialog(null);
    focusScan();
  };

  const add = (product: PosProduct, unitId: string | undefined, qty: string) => {
    setProblem(null);
    if (!product.units.length) {
      setProblem(`${product.name} belum punya satuan jual. Atur di menu Barang.`);
      beepError();
      return;
    }
    const key = usePosStore.getState().addProduct(product, unitId, qty);
    // No price in the master → ask for it right away (FR-POS-05 step 3).
    if (usePosStore.getState().lines.find((l) => l.key === key)?.unitPrice === '') setDialog({ kind: 'price', key });
    else focusScan();
  };

  const notFound = (text: string) => {
    setProblem(`Barang "${text}" tidak ditemukan. Periksa kodenya atau cari dengan nama barang.`);
    beepError();
    focusScan();
  };

  // A scan while focus is elsewhere (a cart button, the page) still adds the product.
  useScanner(
    (code) => {
      void lookupCode(code).then((hit) => (hit ? add(hit.product, hit.unitId, '1') : notFound(code)));
    },
    { ignore: isScanBox, enabled: dialog === null },
  );

  const onLine = (action: LineAction | 'remove') => {
    if (!selectedKey) {
      setProblem('Pilih baris dulu dengan ↑/↓ atau klik barisnya.');
      return;
    }
    setDialog({ kind: action, key: selectedKey });
  };

  const pay = () => {
    if (!lines.length) return setProblem('Nota masih kosong. Scan atau cari barang dulu.');
    if (totals.missingPrice) return setProblem('Masih ada barang tanpa harga. Pilih barisnya lalu tekan Ctrl+H.');
    if (needsCustomer) return setDialog({ kind: 'customer' });
    setProblem(null);
    setDialog({ kind: 'pay' });
  };

  const setMode = (m: SaleChannel) => {
    store().setChannel(m);
    focusScan();
  };

  const handlers: Partial<Record<PosAction, () => void>> = {
    help: () => setDialog({ kind: 'help' }),
    focusScan,
    search: focusScan,
    unit: () => onLine('unit'),
    qty: () => onLine('qty'),
    price: () => onLine('price'),
    customer: () => setDialog({ kind: 'customer' }),
    discount: () => (lines.length ? setDialog({ kind: 'discount' }) : undefined),
    removeLine: () => onLine('remove'),
    up: () => store().moveSelection(-1),
    down: () => store().moveSelection(1),
    pay,
    mode: () => setMode(faktur ? 'KASIR' : 'FAKTUR'),
    charges: () =>
      faktur ? setDialog({ kind: 'charges' }) : setProblem('Ongkos angkut hanya untuk mode Faktur (Ctrl+M).'),
    history: () => setDialog({ kind: 'history' }),
    receivable: () => setDialog({ kind: 'receivable', party: null }),
    hold: () => {
      if (!lines.length) return setProblem('Nota masih kosong — tidak ada yang ditahan.');
      if (totals.missingPrice) return setProblem('Isi dulu harga semua barang (Ctrl+H) sebelum menahan nota.');
      setDialog({ kind: 'hold' });
    },
    recall: () =>
      lines.length
        ? setProblem('Selesaikan, tahan (F6), atau kosongkan nota ini dulu sebelum mengambil nota tertahan.')
        : setDialog({ kind: 'held' }),
    pickup: () => navigate('/pengambilan'),
    reprint: () => (lastSale ? setDialog({ kind: 'done', sale: lastSale }) : setDialog({ kind: 'history' })),
    lock: () => logout.mutate(),
  };
  useHotkeys(POS_HOTKEYS, handlers, dialog === null);

  const line = dialog && 'key' in dialog ? lines.find((l) => l.key === dialog.key) : undefined;
  const storeInfo = settings.data?.store ?? { name: 'Toko', address: null, phone: null };

  return (
    <div className="bg-canvas flex h-screen gap-4 overflow-hidden p-4">
      {/* Main card: mode, search, cart — sections divided by thin canvas bands (owner reference 2026-10-29). */}
      <main className="bg-background flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border shadow-xs">
        <header className="flex items-center gap-3 px-6 pt-5 pb-4">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-muted-foreground hover:text-foreground -ml-1 rounded-md p-1"
            aria-label="Kembali ke menu"
            title="Kembali ke menu"
          >
            <ArrowLeft className="size-5" />
          </button>
          <h1 className="text-lg font-semibold">Kasir</h1>
          <span className="text-muted-foreground text-sm">· {formatDateTime(new Date())}</span>
          <button
            type="button"
            onClick={() => setDialog({ kind: 'history' })}
            className="text-primary hover:text-tani-green-dark ml-auto inline-flex items-center gap-2 text-base font-medium"
          >
            <History className="size-4" /> Nota hari ini <Kbd combo="Ctrl+D" />
          </button>
          <button
            type="button"
            onClick={() => setDialog({ kind: 'receivable', party: null })}
            className="text-primary hover:text-tani-green-dark inline-flex items-center gap-2 text-base font-medium"
          >
            <Wallet className="size-4" /> Terima piutang <Kbd combo="Ctrl+B" />
          </button>
        </header>

        <Section title="Jenis penjualan" aside={<Kbd combo="Ctrl+M" />}>
          <div role="radiogroup" aria-label="Jenis penjualan" className="flex flex-wrap gap-3">
            {MODES.map((m) => (
              <Chip key={m.value} selected={channel === m.value} onClick={() => setMode(m.value)}>
                <m.icon className="size-4" /> {m.label}
                <span className={cn('text-sm', channel === m.value ? 'opacity-80' : 'text-muted-foreground')}>
                  {m.hint}
                </span>
              </Chip>
            ))}
          </div>
        </Section>
        <Band />

        <Section
          title="Cari barang"
          aside={<span className="text-muted-foreground text-sm">ketik 5* untuk jumlah 5</span>}
        >
          <ScanBox onAdd={add} onNotFound={notFound} />
          {problem && (
            <Notice tone="error" className="mt-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span>{problem}</span>
                <button type="button" onClick={() => setProblem(null)} aria-label="Tutup pesan">
                  <X className="size-4" />
                </button>
              </div>
            </Notice>
          )}
        </Section>
        <Band />

        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-base font-semibold">
            Daftar barang <span className="text-muted-foreground font-normal">({lines.length})</span>
          </h2>
          {lines.length > 0 && (
            <button
              type="button"
              onClick={() => setDialog({ kind: 'clear' })}
              className="text-muted-foreground hover:text-error-ink inline-flex items-center gap-1.5 text-sm"
            >
              <Trash2 className="size-4" /> Kosongkan
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6">
          <PosCart onEdit={(key, action) => setDialog({ kind: action, key })} />
        </div>
        <LineActions onAction={onLine} disabled={!selectedKey} />
      </main>

      {/* Right column: summary card with the one primary button, then a small help card. */}
      <aside className="flex w-[380px] shrink-0 flex-col gap-4">
        <div className="bg-background flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border shadow-xs">
          <h2 className="border-b px-5 py-4 text-base font-semibold">Ringkasan nota</h2>

          <div className="space-y-5 overflow-y-auto px-5 py-4">
            <SummaryItem label="Pelanggan" action="Ganti" combo="F8" onAction={() => setDialog({ kind: 'customer' })}>
              {customer ? (
                <>
                  <p className="text-base font-semibold">{customer.name}</p>
                  {customer.groupName && <Pill>Grup {customer.groupName}</Pill>}
                  {(outstanding.data?.length ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => navigate('/pengambilan', { state: { customerId: customer.id } })}
                      className="text-info-ink mt-1.5 block text-left text-sm underline decoration-dotted underline-offset-4"
                    >
                      Masih ada {outstanding.data!.length} barang belum diambil (F11)
                    </button>
                  )}
                </>
              ) : needsCustomer ? (
                <p className="text-error-ink text-base font-medium">Pilih pelanggan — faktur wajib bernama</p>
              ) : (
                <p className="text-base font-semibold">Umum</p>
              )}
            </SummaryItem>

            <div className="space-y-2 border-t pt-4">
              <Row label={`Subtotal · ${totals.itemCount} barang`} value={formatRupiah(totals.subtotal)} />
              <Row
                label="Potongan"
                action="Ubah"
                combo="F10"
                onAction={() => lines.length && setDialog({ kind: 'discount' })}
                value={totals.discount === '0.00' ? '—' : `−${formatRupiah(totals.discount)}`}
                tone={totals.discount === '0.00' ? undefined : 'error'}
              />
              {faktur && (
                <Row
                  label={otherChargesNote ?? 'Ongkos angkut'}
                  action="Ubah"
                  combo="Ctrl+O"
                  onAction={() => setDialog({ kind: 'charges' })}
                  value={totals.otherCharges === '0.00' ? '—' : `+${formatRupiah(totals.otherCharges)}`}
                />
              )}
            </div>

            {pickupLater && <Pill tone="info">Barang diambil nanti</Pill>}
            {totals.missingPrice > 0 && (
              <Notice tone="warning">
                {totals.missingPrice} barang belum ada harganya. Pilih barisnya lalu tekan Ctrl+H.
              </Notice>
            )}
          </div>

          <div className="bg-surface-muted mt-auto space-y-4 border-t px-5 py-5">
            <div>
              <p className="text-base font-medium">Total</p>
              {/* One line always; tens of millions get a slightly smaller size (still read from 1,5 m). */}
              <p
                className={cn(
                  'text-right font-bold tracking-tight whitespace-nowrap tabular-nums',
                  formatRupiah(totals.total).length > 13 ? 'text-4xl' : 'text-5xl',
                )}
                aria-live="polite"
              >
                {formatRupiah(totals.total)}
              </p>
            </div>
            <Button size="lg" className="h-14 w-full text-lg" disabled={!lines.length} onClick={pay}>
              <CreditCard className="size-5" /> Bayar <Kbd combo="F9" light />
            </Button>
          </div>
        </div>

        <HelpCard
          cashier={user?.fullName ?? '—'}
          lastSale={lastSale}
          onHelp={() => setDialog({ kind: 'help' })}
          onReprint={() => lastSale && setDialog({ kind: 'done', sale: lastSale })}
          onLock={() => logout.mutate()}
        />
      </aside>

      {dialog?.kind === 'qty' && line && (
        <QtyDialog line={line} onClose={close} onSave={(q) => (store().setQty(line.key, q), close())} />
      )}
      {dialog?.kind === 'price' && line && (
        <PriceDialog
          line={line}
          customer={customer}
          onClose={close}
          onSave={(p) => (store().setPrice(line.key, p), close())}
        />
      )}
      {dialog?.kind === 'unit' && line && (
        <UnitDialog
          line={line}
          groupId={customer?.groupId ?? null}
          onClose={close}
          onSave={(u) => {
            store().changeUnit(line.key, u);
            const changed = usePosStore.getState().lines.find((l) => l.key === line.key);
            if (changed?.unitPrice === '') setDialog({ kind: 'price', key: line.key });
            else close();
          }}
        />
      )}
      {dialog?.kind === 'discount' && (
        <DiscountDialog
          subtotal={totals.subtotal}
          current={totalTarget}
          onClose={close}
          onSave={(t) => (store().setTotalTarget(t), close())}
        />
      )}
      {dialog?.kind === 'charges' && (
        <ChargesDialog
          amount={otherCharges}
          note={otherChargesNote}
          onClose={close}
          onSave={(a, n) => (store().setOtherCharges(a, n), close())}
        />
      )}
      {dialog?.kind === 'customer' && (
        <CustomerDialog onClose={close} onPick={(c) => (store().setCustomer(c), close())} />
      )}
      {dialog?.kind === 'help' && <HelpDialog onClose={close} />}
      {dialog?.kind === 'receivable' && !dialog.party && (
        <CustomerDialog
          title="Terima pembayaran piutang"
          withWalkIn={false}
          onClose={close}
          onPick={(c) => c && setDialog({ kind: 'receivable', party: { id: c.id, name: c.name } })}
        />
      )}
      {dialog?.kind === 'receivable' && dialog.party && (
        <PartyPaymentDialog side="AR" party={dialog.party} onClose={close} onCloseAutoFocus={focusScan} />
      )}
      {dialog?.kind === 'hold' && (
        <HoldDialog
          onClose={close}
          onDone={() => {
            store().clear();
            setProblem(null);
            close();
          }}
        />
      )}
      {dialog?.kind === 'held' && <HeldListDialog onClose={close} onRecalled={close} />}
      {dialog?.kind === 'pay' && (
        <PaymentDialog
          total={totals.total}
          onClose={close}
          onDone={(sale) => {
            store().clear();
            setLastSale(sale);
            setDialog({ kind: 'done', sale });
            // Stock changed: search results must show the new available qty.
            void qc.invalidateQueries({ queryKey: ['pos', 'products'] });
            void qc.invalidateQueries({ queryKey: ['pos', 'sales'] });
          }}
        />
      )}
      {dialog?.kind === 'done' && <SaleDoneDialog sale={dialog.sale} store={storeInfo} onNext={close} />}
      {dialog?.kind === 'history' && <HistoryDialog store={storeInfo} onClose={close} />}
      <ConfirmDialog
        open={dialog?.kind === 'remove' && !!line}
        onOpenChange={(o) => !o && close()}
        title="Hapus baris?"
        description={line ? `${line.product.name} akan dihapus dari nota.` : undefined}
        confirmLabel="Hapus"
        tone="danger"
        onConfirm={() => {
          if (line) store().removeLine(line.key);
          close();
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'clear'}
        onOpenChange={(o) => !o && close()}
        title="Kosongkan nota?"
        description="Semua barang di nota ini akan dihapus."
        confirmLabel="Kosongkan"
        tone="danger"
        onConfirm={() => {
          store().clear();
          setProblem(null);
          close();
        }}
      />
    </div>
  );
}

const LINE_ACTIONS: { action: LineAction | 'remove'; hotkey: PosAction; icon: typeof Pencil; label: string }[] = [
  { action: 'qty', hotkey: 'qty', icon: PackageSearch, label: 'Jumlah' },
  { action: 'unit', hotkey: 'unit', icon: Ruler, label: 'Satuan' },
  { action: 'price', hotkey: 'price', icon: Pencil, label: 'Harga' },
  { action: 'remove', hotkey: 'removeLine', icon: Trash2, label: 'Hapus' },
];

function LineActions({ onAction, disabled }: { onAction: (a: LineAction | 'remove') => void; disabled: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t px-6 py-3">
      <span className="text-muted-foreground mr-1 text-sm">Baris terpilih:</span>
      {LINE_ACTIONS.map((a) => (
        <Button
          key={a.action}
          variant="outline"
          className={cn('h-10', a.action === 'remove' && 'text-error-ink')}
          disabled={disabled}
          onClick={() => onAction(a.action)}
        >
          <a.icon /> {a.label} <Kbd combo={POS_HOTKEYS[a.hotkey].combo} />
        </Button>
      ))}
      <span className="text-muted-foreground ml-auto text-sm">↑/↓ pilih baris</span>
    </div>
  );
}

/** "Butuh bantuan?" card under the summary — shortcuts, last note, server status, lock. */
function HelpCard({
  cashier,
  lastSale,
  onHelp,
  onReprint,
  onLock,
}: {
  cashier: string;
  lastSale: Sale | null;
  onHelp: () => void;
  onReprint: () => void;
  onLock: () => void;
}) {
  const health = useHealth();
  const ok = health.data?.db.ok === true;
  return (
    <div className="bg-background space-y-3 rounded-lg border p-4 shadow-xs">
      <div className="flex items-start gap-3">
        <span className="bg-tani-green-light text-tani-green-dark flex size-10 shrink-0 items-center justify-center rounded-full">
          <CircleHelp className="size-5" />
        </span>
        <div className="min-w-0 text-sm">
          <p className="text-base font-semibold">Butuh bantuan?</p>
          <p className="text-muted-foreground">Semua bisa dengan keyboard.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="border-primary text-primary h-10" onClick={onHelp}>
          Tombol pintas <Kbd combo="F1" />
        </Button>
        {lastSale && (
          <Button variant="outline" className="h-10" onClick={onReprint}>
            <Printer /> Cetak ulang <Kbd combo="Ctrl+P" />
          </Button>
        )}
      </div>
      <div className="text-muted-foreground flex items-center justify-between gap-2 border-t pt-3 text-sm">
        <span className="flex items-center gap-2">
          <span
            className={cn('size-2 rounded-full', ok ? 'bg-success' : health.isPending ? 'bg-warning' : 'bg-error')}
            aria-hidden
          />
          {cashier} · {ok ? 'server aktif' : 'server tidak terhubung'}
        </span>
        <button type="button" onClick={onLock} className="hover:text-foreground inline-flex items-center gap-1.5">
          <Lock className="size-4" /> Kunci <Kbd combo="Ctrl+Shift+L" />
        </button>
      </div>
    </div>
  );
}
