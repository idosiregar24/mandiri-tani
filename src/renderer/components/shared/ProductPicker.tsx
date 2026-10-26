// Find a product by name, code or barcode (design-standards §2: never a <select> with thousands
// of options). Keyboard: type → ↑/↓ → Enter; Esc clears. Debounce ≤ 150 ms (react-component §4).
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { ProductListItem } from '@shared/schemas/master';
import { Input } from '@/components/ui/input';
import { apiGetPage, toQuery } from '@/lib/api-client';
import { formatNumber } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks';
import { cn } from '@/lib/utils';

interface ProductPickerProps {
  onPick: (product: ProductListItem) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

export function ProductPicker({
  onPick,
  placeholder = 'Cari barang: nama, kode, atau scan barcode…',
  autoFocus,
  className,
}: ProductPickerProps) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const q = useDebouncedValue(text.trim(), 150);
  const results = useQuery({
    queryKey: ['products', 'picker', q],
    queryFn: () => apiGetPage<ProductListItem>(`/products${toQuery({ q, pageSize: 8 })}`),
    enabled: q.length > 0,
    staleTime: 10_000,
  });
  const rows = q ? (results.data?.data ?? []) : [];
  // A new search starts at the first result.
  const [seenQ, setSeenQ] = useState(q);
  if (q !== seenQ) {
    setSeenQ(q);
    setActive(0);
  }

  const pick = (p: ProductListItem | undefined) => {
    if (!p) return;
    onPick(p);
    setText('');
    setOpen(false);
    input.current?.focus();
  };

  return (
    <div className={cn('relative w-full', className)}>
      <Search className="text-muted-foreground absolute top-1/2 left-3 size-5 -translate-y-1/2" aria-hidden />
      <Input
        ref={input}
        role="combobox"
        aria-expanded={open && rows.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoFocus={autoFocus}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, rows.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(rows[active]);
          } else if (e.key === 'Escape') {
            setText('');
            setOpen(false);
          }
        }}
        className="h-11 pl-10 text-base md:text-base"
      />
      {results.isFetching && (
        <Loader2 className="text-muted-foreground absolute top-1/2 right-3 size-5 -translate-y-1/2 animate-spin" />
      )}
      {open && q && (
        <ul
          id={listId}
          role="listbox"
          className="bg-popover absolute z-50 mt-1 max-h-96 w-full overflow-y-auto rounded-lg border p-1 shadow-lg"
        >
          {rows.length === 0 && !results.isFetching && (
            <li className="text-muted-foreground px-3 py-2.5 text-base">Barang tidak ditemukan.</li>
          )}
          {rows.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-4 rounded-md px-3 py-2',
                i === active && 'bg-surface-muted',
              )}
            >
              <span>
                <span className="block text-base font-medium">{p.name}</span>
                <span className="text-muted-foreground font-mono text-sm">{p.sku}</span>
              </span>
              <span className="text-muted-foreground text-sm">
                {p.units
                  .map((u) =>
                    u.conversionQty === '1' ? u.unitCode : `${u.unitCode} (${formatNumber(u.conversionQty)})`,
                  )
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
