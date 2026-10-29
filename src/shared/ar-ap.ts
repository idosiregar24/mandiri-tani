// Pure allocation rule of a receivable/payable payment (FR-ARAP-02), shared by the server
// (authoritative) and the payment dialogs (preview while typing the amount).
import { dec, Decimal, toMoney } from './money';

export interface AllocatableDoc {
  id: string;
  dueDate: string;
  docDate: string;
  docNumber: string;
  open: string;
}

/** Order the store collects in: oldest due date first, then oldest document. */
export function byOldestDue<T extends AllocatableDoc>(docs: readonly T[]): T[] {
  return [...docs].sort(
    (a, b) =>
      a.dueDate.localeCompare(b.dueDate) ||
      a.docDate.localeCompare(b.docDate) ||
      a.docNumber.localeCompare(b.docNumber),
  );
}

/**
 * Spreads `amount` over the documents, oldest due first, never more than each one's open
 * balance. Whatever does not fit is left out — the caller rejects an amount above the total.
 */
export function allocateOldestFirst(
  docs: readonly AllocatableDoc[],
  amount: string,
): { documentId: string; amount: string }[] {
  let left = dec(amount);
  const out: { documentId: string; amount: string }[] = [];
  for (const d of byOldestDue(docs)) {
    if (left.lte(0)) break;
    const take = Decimal.min(left, d.open);
    if (take.lte(0)) continue;
    out.push({ documentId: d.id, amount: toMoney(take) });
    left = left.minus(take);
  }
  return out;
}
