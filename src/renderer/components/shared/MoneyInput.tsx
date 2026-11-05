import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { moneyInputText, parseMoneyInput, typedMoneyInput } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Characters that survive regrouping — the caret is placed by counting these. */
const isKept = (ch: string | undefined) => ch !== undefined && /[\d,]/.test(ch);
const countKept = (s: string) => [...s].filter(isKept).length;

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

  // Regrouping rewrites the text; put the caret back after the same digits so editing in the
  // middle ("1.500.000" → fix one digit) does not jump to the end.
  const caret = useRef<{ el: HTMLInputElement; keep: number } | null>(null);
  useLayoutEffect(() => {
    const c = caret.current;
    if (!c) return;
    caret.current = null;
    const t = c.el.value;
    let pos = 0;
    for (let kept = 0; pos < t.length && kept < c.keep; pos++) if (isKept(t[pos])) kept++;
    c.el.setSelectionRange(pos, pos);
  });

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
          const el = e.target;
          const next = el.value;
          const typed = typedMoneyInput(next);
          if (typed === null) {
            setText(next);
            return;
          }
          caret.current = { el, keep: countKept(next.slice(0, el.selectionStart ?? next.length)) };
          setText(typed.text);
          setSeen(typed.value);
          onChange(typed.value);
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
