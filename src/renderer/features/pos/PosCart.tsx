// The cart (design-standards §3) — not a DataTable: big rows, keyboard selection, and the
// qty / unit / price cells open their dialog on click.
import { AlertTriangle, ShoppingBasket } from 'lucide-react';
import { useEffect } from 'react';
import { formatNumber, formatQty, formatRupiah } from '@/lib/format';
import { cn } from '@/lib/utils';
import { isShort, lineAmount, unitOf, usePosStore, type CartLine } from './store';

export type LineAction = 'qty' | 'unit' | 'price';

export function PosCart({ onEdit }: { onEdit: (key: string, action: LineAction) => void }) {
  const lines = usePosStore((s) => s.lines);
  const selectedKey = usePosStore((s) => s.selectedKey);
  const flashKey = usePosStore((s) => s.flashKey);
  const select = usePosStore((s) => s.select);

  // Keep the selected row in view when ↑/↓ moves past the edge.
  useEffect(() => {
    if (selectedKey) document.getElementById(`cart-${selectedKey}`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);

  if (!lines.length) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 text-center">
        <ShoppingBasket className="size-14 opacity-40" aria-hidden />
        <p className="text-lg">Belum ada barang.</p>
        <p>Scan barcode atau ketik nama barang di kolom atas, lalu tekan Enter.</p>
      </div>
    );
  }

  return (
    <table className="w-full border-collapse text-base">
      <thead className="bg-surface-muted text-muted-foreground sticky top-0 z-10 text-sm">
        <tr>
          <th className="w-12 px-3 py-2 text-left font-normal">No</th>
          <th className="px-3 py-2 text-left font-normal">Barang</th>
          <th className="w-28 px-3 py-2 text-right font-normal">Jumlah</th>
          <th className="w-28 px-3 py-2 text-left font-normal">Satuan</th>
          <th className="w-40 px-3 py-2 text-right font-normal">Harga</th>
          <th className="w-44 px-3 py-2 text-right font-normal">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <Row
            key={l.key}
            line={l}
            no={i + 1}
            selected={l.key === selectedKey}
            flash={l.key === flashKey}
            short={isShort(lines, l)}
            onSelect={() => select(l.key)}
            onEdit={(a) => onEdit(l.key, a)}
          />
        ))}
      </tbody>
    </table>
  );
}

function Row({
  line,
  no,
  selected,
  flash,
  short,
  onSelect,
  onEdit,
}: {
  line: CartLine;
  no: number;
  selected: boolean;
  flash: boolean;
  short: boolean;
  onSelect: () => void;
  onEdit: (a: LineAction) => void;
}) {
  const unit = unitOf(line);
  const amount = lineAmount(line);
  const cell = 'h-14 px-3 align-middle';
  const editable = 'hover:bg-black/[0.04] cursor-pointer rounded-md px-2 py-1';
  return (
    <tr
      id={`cart-${line.key}`}
      onClick={onSelect}
      aria-selected={selected}
      className={cn(
        'border-b transition-colors duration-150',
        selected ? 'bg-tani-green-light shadow-[inset_4px_0_0_var(--color-primary)]' : 'hover:bg-surface-muted',
        flash && !selected && 'bg-tani-harvest/15',
      )}
    >
      <td className={cn(cell, 'text-muted-foreground tabular-nums')}>{no}</td>
      <td className={cell}>
        <p className="font-medium">{line.product.name}</p>
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <span className="font-mono">{line.product.sku}</span>
          {short && (
            <span className="text-warning-ink inline-flex items-center gap-1 font-medium">
              <AlertTriangle className="size-3.5" aria-hidden /> Stok tinggal{' '}
              {formatQty(line.product.availableQty, line.product.baseUnitCode)}
            </span>
          )}
        </p>
      </td>
      <td className={cn(cell, 'text-right tabular-nums')}>
        <button type="button" className={cn(editable, 'font-semibold')} onClick={() => onEdit('qty')} tabIndex={-1}>
          {formatNumber(line.qty)}
        </button>
      </td>
      <td className={cell}>
        <button
          type="button"
          className={cn(editable, line.product.units.length > 1 && 'underline decoration-dotted underline-offset-4')}
          onClick={() => onEdit('unit')}
          tabIndex={-1}
        >
          {unit.unitCode}
        </button>
      </td>
      <td className={cn(cell, 'text-right tabular-nums')}>
        <button
          type="button"
          className={cn(editable, line.unitPrice === '' && 'text-error-ink font-semibold')}
          onClick={() => onEdit('price')}
          tabIndex={-1}
        >
          {line.unitPrice === '' ? 'Isi harga' : formatRupiah(line.unitPrice)}
        </button>
        {line.priceSource === 'MANUAL' && line.listPrice && (
          <p className="text-muted-foreground text-xs">daftar {formatRupiah(line.listPrice)}</p>
        )}
      </td>
      <td className={cn(cell, 'text-right text-lg font-semibold tabular-nums')}>
        {amount ? formatRupiah(amount) : '—'}
      </td>
    </tr>
  );
}
