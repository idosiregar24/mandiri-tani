import { useState, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { moneyInputText, parseMoneyInput } from '@/lib/format';
import { cn } from '@/lib/utils';

interface MoneyInputProps extends Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type'> {
  /** Decimal string ("640000") or "" when empty — never a JS number. */
  value: string;
  onChange: (value: string) => void;
}

/**
 * Shows "1.500.000" while the form holds "1500000". Text that is not a number yet keeps the
 * last valid value and is reformatted when the field loses focus.
 */
export function MoneyInput({ value, onChange, onBlur, className, ...props }: MoneyInputProps) {
  const [text, setText] = useState(() => moneyInputText(value));
  // Follow outside changes (form reset, a record loaded) without fighting the user's typing.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (parseMoneyInput(text) !== value) setText(moneyInputText(value));
  }

  return (
    <div className="relative">
      <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-base">
        Rp
      </span>
      <Input
        {...props}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          const parsed = parseMoneyInput(next);
          if (parsed === null) {
            setText(next);
            return;
          }
          // Re-group thousands while typing whole rupiah ("15000" → "15.000").
          setText(next.includes(',') ? next : moneyInputText(parsed));
          setSeen(parsed);
          onChange(parsed);
        }}
        onBlur={(e) => {
          setText(moneyInputText(value));
          onBlur?.(e);
        }}
        className={cn('h-11 pl-10 text-right text-base tabular-nums md:text-base', className)}
      />
    </div>
  );
}
