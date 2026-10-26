import { useState, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { parseQtyInput, qtyInputText } from '@/lib/format';
import { cn } from '@/lib/utils';

interface QtyInputProps extends Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type'> {
  /** Decimal string with a dot ("0.001") or "" — the form value. */
  value: string;
  onChange: (value: string) => void;
  /** Unit code shown on the right ("KG"). */
  unit?: string;
  /** false → whole numbers only (products without allow_decimal_qty). */
  allowDecimal?: boolean;
}

/** Quantity typed with a decimal comma ("2,5"), unit on the right (design-standards §2). */
export function QtyInput({ value, onChange, onBlur, unit, allowDecimal = true, className, ...props }: QtyInputProps) {
  const [text, setText] = useState(() => qtyInputText(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (parseQtyInput(text) !== value) setText(qtyInputText(value));
  }

  return (
    <div className="relative">
      <Input
        {...props}
        inputMode={allowDecimal ? 'decimal' : 'numeric'}
        autoComplete="off"
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          const parsed = parseQtyInput(next);
          if (parsed !== null && (allowDecimal || !/[.,]/.test(next))) {
            setSeen(parsed);
            onChange(parsed);
          }
        }}
        onBlur={(e) => {
          setText(qtyInputText(value));
          onBlur?.(e);
        }}
        className={cn('h-11 text-right text-base tabular-nums md:text-base', unit && 'pr-16', className)}
      />
      {unit && (
        <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-base">
          {unit}
        </span>
      )}
    </div>
  );
}
