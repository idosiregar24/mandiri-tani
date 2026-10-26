// Server time and business dates (backend-standards §5): business dates are Asia/Jakarta.

/** Current time; tests may replace it through `setClock`. */
let source: () => Date = () => new Date();

export const clock = {
  now: (): Date => source(),
};

/** Tests only: freeze or move the server clock. Pass nothing to restore the real clock. */
export function setClock(fn?: () => Date): void {
  source = fn ?? (() => new Date());
}

const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar date in Asia/Jakarta: { year: 2026, month: 10, day: 26 }. */
export function jakartaDate(d: Date): { year: number; month: number; day: number } {
  const p = Object.fromEntries(parts.formatToParts(d).map((x) => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day) };
}
