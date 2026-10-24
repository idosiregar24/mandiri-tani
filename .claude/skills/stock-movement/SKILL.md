---
name: stock-movement
description: Use when writing or changing any code path that changes stock or HPP (avg_cost) — sale complete/void, sale return, goods receipt, purchase return, stock opname posting, adjustment, transfer, assembly, bundle sales, opening stock, or sync-pushed device documents. Ensures every such path goes through stockService.apply with correct lock order, moving-average cost and ledger rows.
---

# Stock Movement Skill

Stock and HPP are the numbers the owner trusts most and the easiest to
corrupt. Every stock change in the system goes through **one** function:
`stockService.apply(tx, movements, opts)` (`src/server/modules/stock/service.ts`).
Rules: `rules/database-standards.md` §5, PRD §6.4–6.6.

## 1. Build the movement list (in the document's service)

One entry per (product, warehouse, line) in **base units**:

```ts
type MovementInput = {
  productId: string;
  warehouseId: string;
  qty: Decimal;              // signed, base unit: +in / −out (never 0)
  unitCost?: Decimal;        // REQUIRED for costed inflows (receipt, opening, sale return, assembly in)
  sourceType: SourceType;    // must exist in the stock_movements CHECK
  sourceId: string;          // document id
  sourceLineId?: string;     // line id (sale_item, receipt_item…)
  movedAt: Date;             // document business time (trx_at), not now()
  note?: string;
};
```

Mapping per document (PRD §6.6):

| Document | qty | unitCost |
|---|---|---|
| Sale (STANDARD/ASSEMBLY) | −base_qty | — (apply uses current avg; write it back to `sale_items.cost_per_base`) |
| Sale of BUNDLE | one −movement **per component** (component qty × line base_qty), `sourceLineId` = the bundle line | — ; line cost = Σ component costs |
| SERVICE / `track_stock = false` | no movement | — |
| Sale with "picked up later" | qty taken now → `SALE` movement; the rest → **`stockService.reserve`** (no movement, `reserved_qty` +) | — |
| Pickup note (`sale_pickups`, AB) | −base_qty `SALE_PICKUP` — lowers physical `qty` **and** `reserved_qty`; write `unit_cost` to `sale_pickup_items` | — (current avg) |
| Pickup cancelled | +base_qty `SALE_PICKUP_CANCEL` — restores `qty` and `reserved_qty` | original pickup `unit_cost` |
| Return of not-yet-picked-up remainder | **no movement** — `stockService.release` only (goods never left) | — |
| Opening "sold in iPOS, not yet picked up" (go-live) | +base_qty `OPENING` **and** `reserve` | current avg |
| iPOS history import (`sales.source = 'IPOS_IMPORT'`) | **no movement** — opening stock comes from the `OPENING` import instead | — |
| Sale void | exact reverse of the sale's movements (`SALE_VOID`), at their original `unit_cost` | original |
| Sale return (restock) | +base_qty | `cost_per_base` from the original sale line |
| Goods receipt | +base_qty | `(line_total + landed_cost_alloc) / base_qty` |
| Purchase return | −base_qty | — (current avg) |
| Opening stock | +qty | input HPP |
| Opname posting | `counted − system` (skip 0) | — for −; current avg for + |
| Adjustment | signed qty | — for −; current avg for + |
| Transfer | −qty from A and +qty to B at **the same** cost; avg unchanged | current avg |
| Assembly | −components (`ASSEMBLY_OUT`), +product (`ASSEMBLY_IN`) | in = (Σ component cost + extra_cost) / qty |

## 2. What `apply()` does (don't re-implement it elsewhere)

1. Sort by (productId, warehouseId); `INSERT … ON CONFLICT DO NOTHING`
   missing `stock_balances` rows.
2. `SELECT … FOR UPDATE` balances in that order; lock affected `products`
   rows `ORDER BY id FOR UPDATE`.
3. Negative-stock policy (FR-INV-10): sales/reservations check
   **available = qty − reserved_qty**; pickups check physical `qty`. Reject
   with `409 STOCK_INSUFFICIENT` unless `opts.source === 'SYNC'` or
   `opts.allowNegative` (supervisor grant; never for pickups). Message names
   the product and remaining qty in its sale unit.
4. Moving average for costed inflows, using **total qty across all
   warehouses** before the movement:
   `Q ≤ 0 → A' = cost_in`; else `A' = (Q×A + q×cost_in) / (Q+q)`, round 4 dp
   only when storing.
5. Insert `stock_movements` (with `unit_cost`, `avg_cost_after`), update
   balances and `products.avg_cost` / `last_purchase_cost`.
6. Return per-movement `unitCost` so the caller can snapshot line costs.

## 3. Rules for callers

- Call `apply()` **inside the same `withTransaction`** as the document
  insert — never after commit, never in a separate transaction.
- Collect **all** movements of a document and call `apply()` **once** (a
  single sorted lock pass). Calling it per line breaks the lock order and
  invites deadlocks.
- Never `UPDATE stock_balances` / `products.avg_cost` anywhere else.
- Never edit or delete movements — corrections are new documents.
- Business time (`movedAt`) comes from the document; the stock card orders
  by `(moved_at, seq)` and computes running balances, so late-arriving
  synced documents slot in correctly.

## 4. Tests to add (integration, real PostgreSQL)

- Balance after document = expected; `Σ stock_movements.qty` = balance.
- Moving-average example by hand (e.g. 10 sak @150.000 + 10 sak @160.000 →
  avg 155.000; sell 5 → cost_per_base 155.000 snapshot).
- Negative-stock rejection and the SYNC/authorized bypass.
- Void/return restores qty and uses the original cost.
- Bundle sale moves components only.
- Concurrency: two transactions selling the same two products in opposite
  line order complete without deadlock.
- Daily consistency check (`stock_balances` vs ledger) returns zero rows.
