import { useEffect, useState } from 'react';

/** The value, but only after it stopped changing for `ms` (search boxes — ≤ 150 ms for pickers). */
export function useDebouncedValue<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
