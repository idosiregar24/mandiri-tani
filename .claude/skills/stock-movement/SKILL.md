---
name: stock-movement
description: Use when writing or changing any code path that changes stock, reservations or FIFO cost layers — sale complete/void, "picked up later" sales, pickup notes (AB) and their cancellation, sale return, goods receipt / purchase invoice, purchase return, stock opname posting, adjustment, transfer, assembly, bundle sales, opening stock / iPOS import, or sync-pushed device documents. Ensures every such path goes through stockService with the correct lock order, FIFO layer consumption and ledger rows.
---

# Stock Movement Skill

Stock and HPP are the numbers the owner trusts most and the easiest to
corrupt. Every stock change goes through **`stockService`**
(`src/server/modules/stock/service.ts`):

- `apply(tx, movements, opts)` — physical stock (`stock_balances.qty`), ledger
  rows (`stock_movements`) and **FIFO cost layers** (`stock_cost_layers` /
  `stock_layer_consumptions`).
- `reserve(tx, lines)` / `release(tx, lines)` — `stock_balances.reserved_qty`
  for goods sold but not yet picked up (no ledger row, no layers).

Rules: `rules/database-standards.md` §5, PRD §6.4–6.6 (HPP = **FIFO**, same as
iPOS — ADR-04), `plan/sprint-7-pengambilan-barang.md`.

## 1. Build the movement list (in the document's service)

One entry per (product, warehouse, line) in **base units**:

```ts
type MovementInput = {
  productId: string;
  warehouseId: string;
  qty: Decimal;              // signed, base unit: +in / −out (never 0)
  unitCost?: Decimal;        // REQUIRED for costed inflows → becomes the new layer's cost
  layerReceivedAt?: Date;    // inflows that REVERSE an earlier outflow keep the original layer date
  preferLayerSourceLineId?: string; // purchase return: consume this receipt line's layer first
  sourceType: SourceType;    // must exist in the stock_movements CHECK
  sourceId: string;          // document id
  sourceLineId?: string;     // line id (sale_item, receipt_item, pickup_item…)
  movedAt: Date;             // document business time (trx_at), not now()
  note?: string;
};
```

Mapping per document (PRD §6.6):

| Document | Movement | Cost / layers |
|---|---|---|
| Goods receipt / direct purchase invoice (BL) | +base_qty `PURCHASE_RECEIPT` | new layer @ `(line_total + landed_cost_alloc) / base_qty`; updates `last_purchase_cost` |
| Opening stock (iPOS import) | +qty `OPENING` **per iPOS layer** (`tbl_item_im` with sisa > 0) | new layer @ iPOS `hargadasar`, `layerReceivedAt` = iPOS date |
| Sale taken now (STANDARD/ASSEMBLY) | −base_qty `SALE` | consume FIFO; write weighted cost to `sale_items.cost_per_base` |
| Sale of BUNDLE | one −movement **per component**, `sourceLineId` = bundle line | line cost = Σ component FIFO costs |
| SERVICE / `track_stock = false` | none | — |
| Sale "picked up later" (remainder) | **none** — `reserve()` only | cost decided at pickup |
| Pickup note (`sale_pickups`, AB) | −base_qty `SALE_PICKUP` (also lowers `reserved_qty`) | consume FIFO at pickup time; write `unit_cost` to `sale_pickup_items`, refresh `sale_items.cost_per_base` (weighted) |
| Pickup cancelled | +base_qty `SALE_PICKUP_CANCEL` (also raises `reserved_qty`) | re-create layers with the **exact costs & dates** of the cancelled pickup's consumptions |
| Return of not-yet-picked-up remainder | **none** — `release()` only | — |
| Opening "sold in iPOS, not yet picked up" (go-live) | +base_qty `OPENING` **and** `reserve()` | new layer @ `last_purchase_cost` |
| iPOS history import (`sales.source = 'IPOS_IMPORT'`) | **none** — opening stock comes from `OPENING` | line cost copied from iPOS `tbl_item_ik` |
| Sale void | exact reverse `SALE_VOID` | re-create layers with the exact consumed costs & dates |
| Sale return (restock) | +base_qty `SALE_RETURN` | new layer @ original line `cost_per_base` |
| Purchase return | −base_qty `PURCHASE_RETURN` | consume the **original receipt's layer first** (`preferLayerSourceLineId`), then FIFO |
| Opname posting / adjustment | `counted − system` / signed qty | − consume FIFO; + new layer @ `last_purchase_cost` |
| Transfer | −qty from A, +qty to B | consume FIFO at A → new layers at B with the same costs & dates |
| Assembly | −components `ASSEMBLY_OUT`, +product `ASSEMBLY_IN` | in-layer @ (Σ component FIFO cost + extra_cost) / qty |

## 2. What `apply()` does (don't re-implement it elsewhere)

1. Sort by (productId, warehouseId); `INSERT … ON CONFLICT DO NOTHING`
   missing `stock_balances` rows.
2. Lock **all** affected `products` rows `ORDER BY id FOR UPDATE` (this
   serialises access to each product's layers), then balances
   `ORDER BY product_id, warehouse_id FOR UPDATE`.
3. Stock policy (FR-INV-10): sales/reservations check
   **available = qty − reserved_qty**; pickups check physical `qty`. Reject
   with `409 STOCK_INSUFFICIENT` unless `opts.source === 'SYNC'` or
   `opts.allowNegative` (Owner PIN grant; never for pickups). Message names
   the product and remaining qty in its sale unit.
4. Outflows: read layers `WHERE qty_remaining > 0 ORDER BY received_at, id
   FOR UPDATE` (preferred source-line layer first for purchase returns),
   consume oldest first, write one `stock_layer_consumptions` row per layer
   touched. If layers run out (negative stock), the shortfall is costed at
   `last_purchase_cost`, recorded with `layer_id = NULL, is_estimated = true`,
   and the movement gets `cost_estimated = true`.
5. Inflows: insert the movement, then one `stock_cost_layers` row
   (`qty_remaining = qty_in`).
6. Movement `unit_cost` = weighted cost (outflow) or layer cost (inflow);
   round to 4 dp only when storing. Update `stock_balances.qty` (and
   `reserved_qty` for `SALE_PICKUP*`).
7. Return per-movement `unitCost` + consumptions so the caller can snapshot
   line costs.

## 3. Rules for callers

- Call `apply()`/`reserve()`/`release()` **inside the same
  `withTransaction`** as the document insert — never after commit.
- Collect **all** movements of a document and call `apply()` **once** (a
  single sorted lock pass). Calling it per line breaks the lock order and
  invites deadlocks.
- Never `UPDATE stock_balances`, `stock_cost_layers` or insert consumptions
  anywhere else. Never edit or delete movements or consumptions —
  corrections are new documents.
- Reversals (void, pickup cancel) must pass the original consumptions'
  costs and `layerReceivedAt` so FIFO order is preserved.
- Business time (`movedAt`) comes from the document; the stock card orders
  by `(moved_at, seq)` and computes running balances, so late-arriving
  synced documents slot in correctly.

## 4. Tests to add (integration, real PostgreSQL)

- FIFO by hand: buy 100 ZAK Urea @355.000 (5.000 kg @7.100) then 100 ZAK
  @380.000 (5.000 kg @7.600); sell 120 ZAK → cost 7.183,33/kg; remaining
  value = 4.000 kg × 7.600 = Rp 30.400.000.
- Pickup later: sell 20 ZAK pending → no layer consumed; buy at a new price;
  pick up → consumes the oldest layer at pickup time.
- Void / pickup cancel re-creates layers with the original cost & date;
  next sale consumes them in the right order.
- Purchase return consumes its own receipt layer first.
- Negative stock: shortfall flagged `is_estimated`, priced at last purchase cost.
- Invariants: `Σ stock_movements.qty = stock_balances.qty`;
  `Σ layers.qty_remaining = stock_balances.qty` (when ≥ 0);
  `reserved_qty = Σ unpicked remainder`.
- Concurrency: two transactions selling the same two products in opposite
  line order complete without deadlock; no layer is consumed twice.
- iPOS opening import reproduces the iPOS inventory value exactly.
