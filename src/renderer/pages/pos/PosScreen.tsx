// Cashier screen /kasir (PRD §5.3, sprint-5 C4–C8): full screen, no sidebar. Top: scan box;
// left: cart; right: customer, totals and actions; bottom: status bar. Every action works from
// the keyboard and gives focus back to the scan box.
import {
  ArrowLeft,
  CircleHelp,
  CreditCard,
  Lock,
  PackageSearch,
  Pencil,
  Ruler,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { PosProduct } from '@shared/schemas/pos';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Notice } from '@/components/shared/Notice';
import { Button } from '@/components/ui/button';
import { useLogout } from '@/features/auth/api';
import { useHealth } from '@/features/home/api';
import { lookupCode } from '@/features/pos/api';
import {
  CustomerDialog,
  DiscountDialog,
  HelpDialog,
  keyName,
  PriceDialog,
  QtyDialog,
  UnitDialog,
} from '@/features/pos/dialogs';
import { beepError, focusScan, isScanBox } from '@/features/pos/focus';
import { PosCart, type LineAction } from '@/features/pos/PosCart';
import { ScanBox } from '@/features/pos/ScanBox';
import { cartTotals, usePosStore } from '@/features/pos/store';
import { formatDateTime, formatRupiah } from '@/lib/format';
import { POS_HOTKEYS, useHotkeys, type PosAction } from '@/lib/hotkeys';
import { useScanner } from '@/lib/scanner';
import { useSessionUser } from '@/lib/session';
import { cn } from '@/lib/utils';

type DialogState =
  | { kind: LineAction; key: string }
  | { kind: 'discount' | 'customer' | 'help' | 'clear' }
  | { kind: 'remove'; key: string }
  | null;

export function PosScreen() {
  const navigate = useNavigate();
  const user = useSessionUser();
  const logout = useLogout();
  const lines = usePosStore((s) => s.lines);
  const selectedKey = usePosStore((s) => s.selectedKey);
  const customer = usePosStore((s) => s.customer);
  const totalTarget = usePosStore((s) => s.totalTarget);
  const store = usePosStore.getState;
  const totals = cartTotals(lines, totalTarget);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [problem, setProblem] = useState<string | null>(null);

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
    lock: () => logout.mutate(),
  };
  useHotkeys(POS_HOTKEYS, handlers, dialog === null);

  const line = dialog && 'key' in dialog ? lines.find((l) => l.key === dialog.key) : undefined;

  return (
    <div className="bg-canvas flex h-screen flex-col overflow-hidden">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-3 px-4">
        <Button variant="outline" className="h-10" onClick={() => navigate('/')}>
          <ArrowLeft /> Menu
        </Button>
        <h1 className="text-xl font-bold">Kasir</h1>
        <span className="text-muted-foreground ml-auto text-sm">{formatDateTime(new Date())}</span>
      </header>

      <div className="flex min-h-0 flex-1 gap-3 px-3 pb-2">
        {/* Left: scan + cart */}
        <section className="bg-background flex min-w-0 flex-1 flex-col rounded-xl border shadow-xs">
          <div className="space-y-2 border-b p-3">
            <ScanBox onAdd={add} onNotFound={notFound} />
            {problem && (
              <Notice tone="error" className="py-2">
                <div className="flex items-center justify-between gap-3">
                  <span>{problem}</span>
                  <button type="button" onClick={() => setProblem(null)} aria-label="Tutup pesan">
                    <X className="size-4" />
                  </button>
                </div>
              </Notice>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PosCart onEdit={(key, action) => setDialog({ kind: action, key })} />
          </div>
          <LineActions onAction={onLine} disabled={!selectedKey} />
        </section>

        {/* Right: customer, totals, pay */}
        <aside className="flex w-[380px] shrink-0 flex-col gap-3">
          <button
            type="button"
            onClick={() => setDialog({ kind: 'customer' })}
            className="bg-background hover:bg-surface-muted flex items-center gap-3 rounded-xl border p-4 text-left shadow-xs"
          >
            <UserRound className="text-muted-foreground size-6" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-muted-foreground text-sm">Pelanggan</p>
              <p className="truncate text-lg font-semibold">{customer?.name ?? 'Umum'}</p>
              {customer?.groupName && <p className="text-muted-foreground text-sm">Grup {customer.groupName}</p>}
            </div>
            <Kbd combo="F8" />
          </button>

          <div className="bg-background flex flex-1 flex-col rounded-xl border p-5 shadow-xs">
            <dl className="space-y-2 text-lg">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal ({totals.itemCount} barang)</dt>
                <dd className="tabular-nums">{formatRupiah(totals.subtotal)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 underline decoration-dotted underline-offset-4"
                    onClick={() => lines.length && setDialog({ kind: 'discount' })}
                  >
                    Potongan <Kbd combo="F10" />
                  </button>
                </dt>
                <dd className={cn('tabular-nums', totals.discount !== '0.00' && 'text-error-ink')}>
                  {totals.discount === '0.00' ? '—' : `−${formatRupiah(totals.discount)}`}
                </dd>
              </div>
            </dl>
            <div className="mt-4 border-t pt-4">
              <p className="text-muted-foreground text-base">Total</p>
              <p className="text-right text-5xl font-bold tracking-tight tabular-nums" aria-live="polite">
                {formatRupiah(totals.total)}
              </p>
            </div>
            {totals.missingPrice > 0 && (
              <Notice tone="warning" className="mt-4">
                {totals.missingPrice} barang belum ada harganya. Pilih barisnya lalu tekan Ctrl+H.
              </Notice>
            )}
            <div className="mt-auto space-y-2 pt-4">
              <Button size="lg" className="h-16 w-full text-xl" disabled title="Pembayaran dibuat di Sprint 6">
                <CreditCard className="size-6" /> Bayar <Kbd combo="F9" light />
              </Button>
              <p className="text-muted-foreground text-center text-sm">Pembayaran & cetak struk menyusul (Sprint 6).</p>
              <Button
                variant="outline"
                className="h-11 w-full"
                disabled={!lines.length}
                onClick={() => setDialog({ kind: 'clear' })}
              >
                <Trash2 /> Kosongkan nota
              </Button>
            </div>
          </div>
        </aside>
      </div>

      <StatusBar
        cashier={user?.fullName ?? '—'}
        onHelp={() => setDialog({ kind: 'help' })}
        onLock={() => logout.mutate()}
      />

      {dialog?.kind === 'qty' && line && (
        <QtyDialog line={line} onClose={close} onSave={(q) => (store().setQty(line.key, q), close())} />
      )}
      {dialog?.kind === 'price' && line && (
        <PriceDialog line={line} onClose={close} onSave={(p) => (store().setPrice(line.key, p), close())} />
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
      {dialog?.kind === 'customer' && (
        <CustomerDialog onClose={close} onPick={(c) => (store().setCustomer(c), close())} />
      )}
      {dialog?.kind === 'help' && <HelpDialog onClose={close} />}
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

function Kbd({ combo, light }: { combo: string; light?: boolean }) {
  return (
    <kbd className={cn('rounded border px-1.5 font-mono text-xs', light ? 'border-white/40' : 'bg-surface-muted')}>
      {keyName(combo)}
    </kbd>
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
    <div className="flex flex-wrap gap-2 border-t p-3">
      {LINE_ACTIONS.map((a) => (
        <Button
          key={a.action}
          variant="outline"
          className={cn('h-11', a.action === 'remove' && 'text-error-ink')}
          disabled={disabled}
          onClick={() => onAction(a.action)}
        >
          <a.icon /> {a.label} <Kbd combo={POS_HOTKEYS[a.hotkey].combo} />
        </Button>
      ))}
      <span className="text-muted-foreground ml-auto self-center text-sm">↑/↓ pilih baris</span>
    </div>
  );
}

function StatusBar({ cashier, onHelp, onLock }: { cashier: string; onHelp: () => void; onLock: () => void }) {
  const health = useHealth();
  const ok = health.data?.db.ok === true;
  return (
    <footer className="flex h-10 shrink-0 items-center gap-5 border-t bg-background px-4 text-sm">
      <span>
        Kasir: <b>{cashier}</b>
      </span>
      <span className="text-muted-foreground">Shift: belum dibuka (Sprint 6)</span>
      <span className="flex items-center gap-2">
        <span
          className={cn('size-2 rounded-full', ok ? 'bg-success' : health.isPending ? 'bg-warning' : 'bg-error')}
          aria-hidden
        />
        {ok ? 'Server & database berjalan' : 'Server tidak terhubung'}
      </span>
      <span className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onHelp}>
          <CircleHelp /> Bantuan <Kbd combo="F1" />
        </Button>
        <Button variant="ghost" size="sm" onClick={onLock}>
          <Lock /> Kunci <Kbd combo="Ctrl+Shift+L" />
        </Button>
      </span>
    </footer>
  );
}
