// The cashier's scan / search box (FR-POS-01…03). Always gets focus back after an action.
// Enter: the highlighted search result, else an exact barcode/SKU lookup. "5*" before the code
// or name sets the quantity.
import { Loader2, ScanBarcode } from 'lucide-react';
import { useId, useState } from 'react';
import { dec } from '@shared/money';
import { parseQtyPrefix } from '@shared/pos';
import { resolvePrice } from '@shared/pricing';
import type { PosProduct } from '@shared/schemas/pos';
import { formatQty, formatRupiah } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { lookupCode, usePosSearch } from './api';
import { registerScanBox } from './focus';
import { defaultUnit, usePosStore } from './store';

interface ScanBoxProps {
  /** Product (and unit, when a barcode chose one) to add with the qty prefix. */
  onAdd: (product: PosProduct, unitId: string | undefined, qty: string) => void;
  onNotFound: (text: string) => void;
}

export function ScanBox({ onAdd, onNotFound }: ScanBoxProps) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const listId = useId();
  const groupId = usePosStore((s) => s.customer?.groupId ?? null);

  const prefix = parseQtyPrefix(text);
  const query = (prefix ? prefix.rest : text).trim();
  const debounced = useDebouncedValue(query, 120);
  const search = usePosSearch(debounced);
  // Only results for exactly what is in the box now — never a previous search's list.
  const results = search.data && !search.isPlaceholderData && debounced === query && query ? search.data : [];
  const open = results.length > 0;

  const reset = () => {
    setText('');
    setActive(0);
  };

  const pick = (p: PosProduct, unitId?: string) => {
    onAdd(p, unitId, prefix?.qty ?? '1');
    reset();
  };

  const submit = async () => {
    if (open) return pick(results[Math.min(active, results.length - 1)]!);
    if (!query) return;
    setBusy(true);
    try {
      const hit = await lookupCode(query);
      if (hit) pick(hit.product, hit.unitId);
      else onNotFound(query);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <ScanBarcode
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2"
        aria-hidden
      />
      <input
        ref={registerScanBox}
        autoFocus
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          } else if (e.key === 'Escape' && text) {
            e.preventDefault();
            reset();
          } else if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault(); // the list owns the arrows while it is open (cart rows otherwise)
            setActive((i) => (e.key === 'ArrowDown' ? Math.min(results.length - 1, i + 1) : Math.max(0, i - 1)));
          }
        }}
        placeholder="Scan barcode atau ketik nama barang…"
        aria-label="Scan atau cari barang"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        spellCheck={false}
        className="border-input bg-background focus-visible:border-primary focus-visible:ring-ring/30 h-12 w-full rounded-md border pr-28 pl-12 text-lg outline-none focus-visible:ring-4"
      />
      <span className="text-muted-foreground absolute top-1/2 right-4 flex -translate-y-1/2 items-center gap-2 text-sm">
        {(busy || search.isFetching) && <Loader2 className="size-4 animate-spin" aria-label="Mencari" />}
        {prefix && (
          <span className="bg-tani-green-light text-tani-green-dark rounded-md px-2 py-0.5 font-medium">
            × {formatQty(prefix.qty)}
          </span>
        )}
        <kbd className="rounded border px-1.5">F2</kbd>
      </span>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="bg-background absolute inset-x-0 top-full z-20 mt-1 max-h-[60vh] overflow-y-auto rounded-xl border shadow-lg"
        >
          {results.map((p, i) => {
            const unit = defaultUnit(p);
            const price = resolvePrice(unit.prices, { groupId, qty: prefix?.qty ?? '1' });
            return (
              <li
                key={p.id}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus in the box
                  pick(p);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'flex min-h-14 cursor-pointer items-center gap-4 border-b px-4 py-2 last:border-b-0',
                  i === active && 'bg-tani-green-light',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium">{p.name}</p>
                  <p className="text-muted-foreground font-mono text-sm">{p.sku}</p>
                </div>
                <div className="text-muted-foreground w-36 text-right text-sm tabular-nums">
                  {p.trackStock ? (
                    <span className={cn(dec(p.availableQty).lte(0) && 'text-error-ink font-medium')}>
                      Stok {formatQty(p.availableQty, p.baseUnitCode)}
                    </span>
                  ) : (
                    'Jasa'
                  )}
                </div>
                <div className="w-40 text-right tabular-nums">
                  <p className="text-base font-semibold">{price ? formatRupiah(price.price) : 'Isi harga'}</p>
                  <p className="text-muted-foreground text-sm">per {unit.unitCode.toLowerCase()}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
