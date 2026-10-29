// Small dialogs of the cashier screen. Each one: focus starts in its main control, Enter
// confirms, Esc closes, and focus goes back to the scan box afterwards (frontend-standards §6).
import { Check, Search, UserRound, X } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { dec } from '@shared/money';
import { discountForTarget, suggestedTotal } from '@shared/pos';
import { resolvePrice } from '@shared/pricing';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { Notice } from '@/components/shared/Notice';
import { QtyInput } from '@/components/shared/QtyInput';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatNumber, formatQty, formatRupiah } from '@/lib/format';
import { POS_HOTKEYS } from '@/lib/hotkeys';
import { useDebouncedValue } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { useCustomerSearch } from './api';
import { focusScan } from './focus';
import { unitOf, type CartCustomer, type CartLine } from './store';

const bigInput = 'h-14 text-2xl md:text-2xl tabular-nums';

function PosDialog({
  title,
  description,
  onClose,
  children,
  wide,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className={cn(wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          focusScan();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-xl">{title}</DialogTitle>
          {description && <DialogDescription className="text-base">{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function Footer({ onClose, label = 'Simpan', disabled }: { onClose: () => void; label?: string; disabled?: boolean }) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" className="h-11" onClick={onClose}>
        Batal <kbd className="ml-1 text-xs opacity-70">Esc</kbd>
      </Button>
      <Button type="submit" className="h-11 px-5" disabled={disabled}>
        <Check /> {label} <kbd className="ml-1 text-xs opacity-70">Enter</kbd>
      </Button>
    </DialogFooter>
  );
}

const submitWith = (fn: () => void) => (e: FormEvent) => {
  e.preventDefault();
  fn();
};

// ------------------------------------------------------------------ qty (F5)

export function QtyDialog({
  line,
  onSave,
  onClose,
}: {
  line: CartLine;
  onSave: (qty: string) => void;
  onClose: () => void;
}) {
  const [qty, setQty] = useState(line.qty);
  const unit = unitOf(line);
  const ok = qty !== '' && dec(qty).gt(0);
  return (
    <PosDialog title="Ubah jumlah" description={line.product.name} onClose={onClose}>
      <form onSubmit={submitWith(() => ok && onSave(qty))} className="space-y-4">
        <QtyInput
          autoFocus
          value={qty}
          onChange={setQty}
          unit={unit.unitCode}
          allowDecimal={line.product.allowDecimalQty}
          onFocus={(e) => e.currentTarget.select()}
          className={bigInput}
          aria-label="Jumlah"
        />
        {!line.product.allowDecimalQty && (
          <p className="text-muted-foreground">Barang ini dijual dalam bilangan bulat.</p>
        )}
        {qty !== '' && !ok && <p className="text-error-ink">Jumlah harus lebih dari 0.</p>}
        <Footer onClose={onClose} disabled={!ok} />
      </form>
    </PosDialog>
  );
}

// ------------------------------------------------------------------ price (Ctrl+H)

export function PriceDialog({
  line,
  onSave,
  onClose,
}: {
  line: CartLine;
  onSave: (price: string) => void;
  onClose: () => void;
}) {
  const [price, setPrice] = useState(line.unitPrice);
  const unit = unitOf(line);
  const ok = price !== '' && dec(price).gt(0);
  return (
    <PosDialog
      title="Ubah harga"
      description={
        <>
          {line.product.name} — per {unit.unitCode.toLowerCase()}
        </>
      }
      onClose={onClose}
    >
      <form onSubmit={submitWith(() => ok && onSave(price))} className="space-y-4">
        <MoneyInput
          autoFocus
          value={price}
          onChange={setPrice}
          onFocus={(e) => e.currentTarget.select()}
          className={cn(bigInput, 'pl-12')}
          aria-label="Harga"
        />
        <p className="text-muted-foreground">
          Harga daftar:{' '}
          <span className="text-foreground font-medium">
            {line.listPrice ? formatRupiah(line.listPrice) : 'belum ada'}
          </span>
        </p>
        {price !== '' && !ok && <p className="text-error-ink">Isi harga lebih dari Rp 0.</p>}
        <Footer onClose={onClose} disabled={!ok} />
      </form>
    </PosDialog>
  );
}

// ------------------------------------------------------------------ unit (F4)

export function UnitDialog({
  line,
  groupId,
  onSave,
  onClose,
}: {
  line: CartLine;
  groupId: string | null;
  onSave: (unitId: string) => void;
  onClose: () => void;
}) {
  const units = line.product.units;
  const [active, setActive] = useState(
    Math.max(
      0,
      units.findIndex((u) => u.id === line.unitId),
    ),
  );
  const base = line.product.baseUnitCode;
  return (
    <PosDialog
      title="Ganti satuan"
      description={`${line.product.name} — tekan angka atau ↑/↓ lalu Enter`}
      onClose={onClose}
    >
      <ul
        role="listbox"
        tabIndex={0}
        autoFocus
        className="space-y-2 outline-none"
        onKeyDown={(e) => {
          const n = Number(e.key);
          if (n >= 1 && n <= units.length) {
            e.preventDefault();
            onSave(units[n - 1]!.id);
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => (e.key === 'ArrowDown' ? Math.min(units.length - 1, i + 1) : Math.max(0, i - 1)));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            onSave(units[active]!.id);
          }
        }}
      >
        {units.map((u, i) => {
          const price = resolvePrice(u.prices, { groupId, qty: line.qty });
          return (
            <li
              key={u.id}
              role="option"
              aria-selected={i === active}
              onClick={() => onSave(u.id)}
              className={cn(
                'flex h-14 cursor-pointer items-center gap-4 rounded-lg border px-4',
                i === active && 'border-primary bg-tani-green-light',
              )}
            >
              <kbd className="flex size-7 items-center justify-center rounded border text-sm">{i + 1}</kbd>
              <div className="flex-1">
                <p className="text-lg font-semibold">{u.unitCode}</p>
                {!u.isBase && (
                  <p className="text-muted-foreground text-sm">
                    1 {u.unitCode.toLowerCase()} = {formatQty(u.conversionQty, base)}
                  </p>
                )}
              </div>
              <p className="text-lg tabular-nums">
                {price ? formatRupiah(price.price) : <span className="text-muted-foreground">isi harga</span>}
              </p>
              {u.id === line.unitId && <Check className="text-tani-green size-5" aria-label="dipakai" />}
            </li>
          );
        })}
      </ul>
    </PosDialog>
  );
}

// ------------------------------------------------------------------ note discount (F10)

export function DiscountDialog({
  subtotal,
  current,
  onSave,
  onClose,
}: {
  subtotal: string;
  current: string | null;
  onSave: (target: string | null) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState(current ?? dec(suggestedTotal(subtotal)).toFixed());
  const discount = target === '' ? null : discountForTarget(subtotal, target);
  return (
    <PosDialog
      title="Potongan nota"
      description={<>Ketik total yang dibayar pembeli. Subtotal {formatRupiah(subtotal)}.</>}
      onClose={onClose}
    >
      <form
        onSubmit={submitWith(() => discount !== null && onSave(dec(discount).isZero() ? null : target))}
        className="space-y-4"
      >
        <label className="block space-y-2">
          <span className="text-base font-medium">Total jadi</span>
          <MoneyInput
            autoFocus
            value={target}
            onChange={setTarget}
            onFocus={(e) => e.currentTarget.select()}
            className={cn(bigInput, 'pl-12')}
          />
        </label>
        {discount === null ? (
          <p className="text-error-ink">Total jadi tidak boleh lebih dari subtotal.</p>
        ) : (
          <p className="text-lg">
            Potongan: <span className="font-semibold tabular-nums">{formatRupiah(discount)}</span>
          </p>
        )}
        <DialogFooter className="sm:justify-between">
          {current !== null ? (
            <Button type="button" variant="outline" className="h-11" onClick={() => onSave(null)}>
              <X /> Hapus potongan
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" className="h-11 px-5" disabled={discount === null}>
              <Check /> Simpan <kbd className="ml-1 text-xs opacity-70">Enter</kbd>
            </Button>
          </div>
        </DialogFooter>
      </form>
    </PosDialog>
  );
}

// ------------------------------------------------------------------ customer (F8)

export function CustomerDialog({ onPick, onClose }: { onPick: (c: CartCustomer | null) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const debounced = useDebouncedValue(q.trim(), 150);
  const found = useCustomerSearch(debounced, true);
  const rows = (found.data?.data ?? []).filter((c) => !c.isWalkIn && c.isActive);
  // Row 0 is always "Umum" (walk-in).
  const options: (CartCustomer | null)[] = [
    null,
    ...rows.map((c) => ({ id: c.id, name: c.name, groupId: c.customerGroupId, groupName: c.customerGroupName })),
  ];
  const phones = new Map(rows.map((c) => [c.id, c.phone]));
  return (
    <PosDialog title="Pilih pelanggan" description="Ketik nama atau nomor HP." onClose={onClose} wide>
      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
          aria-hidden
        />
        <Input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => (e.key === 'ArrowDown' ? Math.min(options.length - 1, i + 1) : Math.max(0, i - 1)));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              onPick(options[Math.min(active, options.length - 1)] ?? null);
            }
          }}
          className="h-12 pl-11 text-lg md:text-lg"
          aria-label="Cari pelanggan"
        />
      </div>
      <ul role="listbox" className="max-h-[50vh] space-y-1 overflow-y-auto">
        {options.map((c, i) => (
          <li
            key={c?.id ?? 'umum'}
            role="option"
            aria-selected={i === active}
            onClick={() => onPick(c)}
            onMouseEnter={() => setActive(i)}
            className={cn(
              'flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-4 py-2',
              i === active ? 'border-primary bg-tani-green-light' : 'border-transparent',
            )}
          >
            <UserRound className="text-muted-foreground size-5" aria-hidden />
            <div className="flex-1">
              <p className="font-medium">{c ? c.name : 'Umum (tanpa nama)'}</p>
              {c && phones.get(c.id) && <p className="text-muted-foreground text-sm">{phones.get(c.id)}</p>}
            </div>
            {c?.groupName && <span className="bg-surface-muted rounded-full border px-2 text-sm">{c.groupName}</span>}
          </li>
        ))}
      </ul>
      {found.data && found.data.meta.total > rows.length && (
        <p className="text-muted-foreground text-sm">
          Menampilkan {formatNumber(String(rows.length))} pelanggan pertama — ketik lebih lengkap.
        </p>
      )}
    </PosDialog>
  );
}

// ------------------------------------------------------------------ help (F1)

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <PosDialog title="Tombol pintas kasir" onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-x-8 gap-y-2">
        {Object.values(POS_HOTKEYS).map((hk) => (
          <div key={hk.combo} className="flex items-center justify-between gap-3 border-b py-1.5">
            <span className={cn('soon' in hk && 'text-muted-foreground')}>
              {hk.label}
              {'soon' in hk && <span className="ml-2 text-xs">(segera)</span>}
            </span>
            <kbd className="bg-surface-muted rounded border px-2 py-0.5 font-mono text-sm">{keyName(hk.combo)}</kbd>
          </div>
        ))}
      </div>
      <Notice tone="info">
        Ketik <b>5*</b> sebelum scan atau nama barang untuk langsung menambah 5. Klik jumlah, satuan, atau harga di
        keranjang untuk mengubahnya.
      </Notice>
    </PosDialog>
  );
}

export const keyName = (combo: string) =>
  combo.replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('Delete', 'Del');
