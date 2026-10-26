// stockService against real PostgreSQL (skill stock-movement §4). Synthetic products only.
import pino from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@shared/uuid';
import { createTestDatabase, type TestDatabase } from '../../../../test/pg';
import { migrationsDir } from '../../../../test/paths';
import { runMigrations } from '../../db/migrate';
import { createPool, type Pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import * as stock from './service';

let tdb: TestDatabase;
let pool: Pool;
let wh: string;
let kg: string;
let zak: string;

beforeAll(async () => {
  tdb = await createTestDatabase();
  pool = createPool(tdb.config);
  await runMigrations(pool, migrationsDir, pino({ level: 'silent' }));
  wh = (await pool.query<{ id: string }>("SELECT id FROM warehouses WHERE code = 'UTM'")).rows[0]!.id;
  const units = await pool.query<{ id: string; code: string }>(
    "SELECT id, code FROM units WHERE code IN ('KG', 'ZAK')",
  );
  kg = units.rows.find((u) => u.code === 'KG')!.id;
  zak = units.rows.find((u) => u.code === 'ZAK')!.id;
});
afterAll(async () => {
  await pool?.end();
  await tdb?.drop();
});

/** A pupuk sold per ZAK (= 50 KG), stocked in KG. */
async function newProduct(name: string): Promise<string> {
  const id = uuidv7();
  await pool.query(`INSERT INTO products (id, sku, name, base_unit_id) VALUES ($1, $2, $3, $4)`, [
    id,
    `T-${id.slice(-8)}`,
    name,
    kg,
  ]);
  await pool.query(
    `INSERT INTO product_units (id, product_id, unit_id, conversion_qty, is_base, is_default_sale) VALUES
       ($1, $3, $4, 1, true, false), ($2, $3, $5, 50, false, true)`,
    [uuidv7(), uuidv7(), id, kg, zak],
  );
  return id;
}

const doc = () => uuidv7();
const day = (d: number) => new Date(Date.UTC(2026, 9, d, 2, 0, 0));
const run = <T>(fn: (tx: Parameters<Parameters<typeof withTransaction>[1]>[0]) => Promise<T>) =>
  withTransaction(pool, fn);

async function snapshot(productId: string) {
  const r = await pool.query<{ qty: string; reserved: string; ledger: string; layers: string; value: string }>(
    `SELECT b.qty::text AS qty, b.reserved_qty::text AS reserved,
            (SELECT coalesce(sum(qty), 0)::text FROM stock_movements m WHERE m.product_id = b.product_id AND m.warehouse_id = b.warehouse_id) AS ledger,
            (SELECT coalesce(sum(qty_remaining), 0)::text FROM stock_cost_layers l WHERE l.product_id = b.product_id AND l.warehouse_id = b.warehouse_id) AS layers,
            (SELECT coalesce(sum(qty_remaining * unit_cost), 0)::numeric(18,2)::text FROM stock_cost_layers l WHERE l.product_id = b.product_id AND l.warehouse_id = b.warehouse_id) AS value
     FROM stock_balances b WHERE b.product_id = $1 AND b.warehouse_id = $2`,
    [productId, wh],
  );
  return r.rows[0]!;
}

/** Ledger = balance always; layers = balance whenever stock is not negative (PRD §6.6). */
async function expectInvariants(productId: string) {
  const s = await snapshot(productId);
  expect(Number(s.ledger)).toBe(Number(s.qty));
  if (Number(s.qty) >= 0) expect(Number(s.layers)).toBe(Number(s.qty));
  return s;
}

const products: string[] = [];
afterEach(async () => {
  for (const p of products.splice(0)) await expectInvariants(p);
});

describe('stockService.apply — FIFO (PRD §6.6 Urea example)', () => {
  it('consumes the oldest layer first and costs the sale at the weighted layer cost', async () => {
    const urea = await newProduct('Urea Contoh');
    products.push(urea);
    await run((tx) =>
      stock.apply(tx, [
        {
          productId: urea,
          warehouseId: wh,
          qty: '5000',
          unitCost: '7100',
          sourceType: 'PURCHASE_RECEIPT',
          sourceId: doc(),
          movedAt: day(1),
        },
        {
          productId: urea,
          warehouseId: wh,
          qty: '5000',
          unitCost: '7600',
          sourceType: 'PURCHASE_RECEIPT',
          sourceId: doc(),
          movedAt: day(15),
        },
      ]),
    );
    const [sale] = await run((tx) =>
      stock.apply(tx, [
        { productId: urea, warehouseId: wh, qty: '-6000', sourceType: 'SALE', sourceId: doc(), movedAt: day(20) },
      ]),
    );
    expect(sale!.unitCost).toBe('7183.3333');
    expect(sale!.costEstimated).toBe(false);
    expect(sale!.consumptions.map((c) => [c.qty, c.unitCost])).toEqual([
      ['5000.0000', '7100.0000'],
      ['1000.0000', '7600.0000'],
    ]);
    const s = await snapshot(urea);
    expect(s).toMatchObject({ qty: '4000.0000', layers: '4000.0000', value: '30400000.00' });
    const cost = await pool.query('SELECT last_purchase_cost::text AS c FROM products WHERE id = $1', [urea]);
    expect(cost.rows[0]?.c).toBe('7600.0000');
  });

  it('refuses a sale above AVAILABLE stock, naming the product in its sale unit (409)', async () => {
    const p = await newProduct('NPK Contoh');
    products.push(p);
    await run((tx) =>
      stock.apply(tx, [
        {
          productId: p,
          warehouseId: wh,
          qty: '4000',
          unitCost: '7000',
          sourceType: 'PURCHASE_RECEIPT',
          sourceId: doc(),
          movedAt: day(1),
        },
      ]),
    );
    const err = await run((tx) =>
      stock.apply(tx, [
        { productId: p, warehouseId: wh, qty: '-4500', sourceType: 'SALE', sourceId: doc(), movedAt: day(2) },
      ]),
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: 'STOCK_INSUFFICIENT',
      status: 409,
      message: 'Stok tersedia NPK Contoh tinggal 80 zak. Kurangi jumlahnya atau minta PIN Owner.',
    });
    // Nothing was written: the whole transaction rolled back.
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM stock_movements WHERE product_id = $1', [p])).rows[0],
    ).toEqual({ n: 1 });
  });

  it('applies a synced sale below zero, costs the shortfall at the last purchase price, and refills before layering', async () => {
    const p = await newProduct('KCL Contoh');
    products.push(p);
    await run((tx) =>
      stock.apply(tx, [
        {
          productId: p,
          warehouseId: wh,
          qty: '1000',
          unitCost: '9000',
          sourceType: 'PURCHASE_RECEIPT',
          sourceId: doc(),
          movedAt: day(1),
        },
      ]),
    );
    const [sale] = await run((tx) =>
      stock.apply(
        tx,
        [{ productId: p, warehouseId: wh, qty: '-1500', sourceType: 'SALE', sourceId: doc(), movedAt: day(2) }],
        { source: 'SYNC' },
      ),
    );
    expect(sale!.costEstimated).toBe(true);
    expect(sale!.consumptions.map((c) => [c.qty, c.isEstimated])).toEqual([
      ['1000.0000', false],
      ['500.0000', true],
    ]);
    expect(await snapshot(p)).toMatchObject({ qty: '-500.0000', layers: '0.0000' });
    // The next receipt first fills the 500 kg hole; only the rest becomes a layer.
    await run((tx) =>
      stock.apply(tx, [
        {
          productId: p,
          warehouseId: wh,
          qty: '2000',
          unitCost: '9500',
          sourceType: 'PURCHASE_RECEIPT',
          sourceId: doc(),
          movedAt: day(3),
        },
      ]),
    );
    expect(await snapshot(p)).toMatchObject({ qty: '1500.0000', layers: '1500.0000', value: '14250000.00' });
  });

  it('a reversal re-creates the consumed layers with their original cost and date, so FIFO order is kept', async () => {
    const p = await newProduct('Dolomit Contoh');
    products.push(p);
    await run((tx) =>
      stock.apply(tx, [
        {
          productId: p,
          warehouseId: wh,
          qty: '100',
          unitCost: '1000',
          sourceType: 'PURCHASE_RECEIPT',
          sourceId: doc(),
          movedAt: day(1),
        },
        {
          productId: p,
          warehouseId: wh,
          qty: '100',
          unitCost: '2000',
          sourceType: 'PURCHASE_RECEIPT',
          sourceId: doc(),
          movedAt: day(5),
        },
      ]),
    );
    const [sale] = await run((tx) =>
      stock.apply(tx, [
        { productId: p, warehouseId: wh, qty: '-100', sourceType: 'SALE', sourceId: doc(), movedAt: day(6) },
      ]),
    );
    await run((tx) =>
      stock.apply(
        tx,
        sale!.consumptions.map((c) => ({
          productId: p,
          warehouseId: wh,
          qty: c.qty,
          unitCost: c.unitCost,
          layerReceivedAt: c.layerReceivedAt!,
          sourceType: 'SALE_VOID' as const,
          sourceId: doc(),
          movedAt: day(7),
        })),
      ),
    );
    const [next] = await run((tx) =>
      stock.apply(tx, [
        { productId: p, warehouseId: wh, qty: '-100', sourceType: 'SALE', sourceId: doc(), movedAt: day(8) },
      ]),
    );
    expect(next!.unitCost).toBe('1000.0000'); // the voided goods are again the oldest layer
  });

  it('opname/adjustment inflows default to the last purchase cost', async () => {
    const p = await newProduct('ZA Contoh');
    products.push(p);
    await run((tx) =>
      stock.apply(tx, [
        {
          productId: p,
          warehouseId: wh,
          qty: '50',
          unitCost: '4000',
          sourceType: 'PURCHASE_RECEIPT',
          sourceId: doc(),
          movedAt: day(1),
        },
      ]),
    );
    const [adj] = await run((tx) =>
      stock.apply(tx, [
        { productId: p, warehouseId: wh, qty: '10', sourceType: 'ADJUSTMENT', sourceId: doc(), movedAt: day(2) },
      ]),
    );
    expect(adj!.unitCost).toBe('4000.0000');
  });

  it('the ledger is append-only', async () => {
    await expect(pool.query('UPDATE stock_movements SET qty = 1')).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM stock_layer_consumptions')).rejects.toThrow(/append-only/);
  });
});

describe('stockService.reserve / release & pickups (sprint-7)', () => {
  it('reserved goods lower AVAILABLE stock only; a pickup lowers physical and reserved together', async () => {
    const p = await newProduct('SS Contoh');
    products.push(p);
    await run((tx) =>
      stock.apply(tx, [
        {
          productId: p,
          warehouseId: wh,
          qty: '1000',
          unitCost: '5000',
          sourceType: 'PURCHASE_RECEIPT',
          sourceId: doc(),
          movedAt: day(1),
        },
      ]),
    );
    await run((tx) => stock.reserve(tx, [{ productId: p, warehouseId: wh, qty: '800' }]));
    expect(await snapshot(p)).toMatchObject({ qty: '1000.0000', reserved: '800.0000' });

    const sale = await run((tx) =>
      stock.apply(tx, [
        { productId: p, warehouseId: wh, qty: '-300', sourceType: 'SALE', sourceId: doc(), movedAt: day(2) },
      ]),
    ).catch((e: unknown) => e);
    expect(sale).toMatchObject({ code: 'STOCK_INSUFFICIENT' }); // only 200 available
    expect(
      await run((tx) => stock.reserve(tx, [{ productId: p, warehouseId: wh, qty: '300' }])).catch((e: unknown) => e),
    ).toMatchObject({ code: 'STOCK_INSUFFICIENT' });

    await run((tx) =>
      stock.apply(tx, [
        { productId: p, warehouseId: wh, qty: '-500', sourceType: 'SALE_PICKUP', sourceId: doc(), movedAt: day(3) },
      ]),
    );
    expect(await snapshot(p)).toMatchObject({ qty: '500.0000', reserved: '300.0000' });
    await run((tx) => stock.release(tx, [{ productId: p, warehouseId: wh, qty: '300' }]));
    expect(await snapshot(p)).toMatchObject({ qty: '500.0000', reserved: '0.0000' });
    expect(
      await run((tx) => stock.release(tx, [{ productId: p, warehouseId: wh, qty: '1' }])).catch((e: unknown) => e),
    ).toMatchObject({
      code: 'RESERVATION_INSUFFICIENT',
    });
  });
});

describe('stockService — concurrency (PRD §6.5)', () => {
  it('two documents touching the same products in opposite order finish without deadlock and consume no layer twice', async () => {
    const a = await newProduct('Paralel A');
    const b = await newProduct('Paralel B');
    products.push(a, b);
    await run((tx) =>
      stock.apply(tx, [
        {
          productId: a,
          warehouseId: wh,
          qty: '100',
          unitCost: '1000',
          sourceType: 'PURCHASE_RECEIPT',
          sourceId: doc(),
          movedAt: day(1),
        },
        {
          productId: b,
          warehouseId: wh,
          qty: '100',
          unitCost: '1000',
          sourceType: 'PURCHASE_RECEIPT',
          sourceId: doc(),
          movedAt: day(1),
        },
      ]),
    );
    const sell = (first: string, second: string) =>
      run(async (tx) => {
        const out = await stock.apply(tx, [
          { productId: first, warehouseId: wh, qty: '-10', sourceType: 'SALE', sourceId: doc(), movedAt: day(2) },
          { productId: second, warehouseId: wh, qty: '-10', sourceType: 'SALE', sourceId: doc(), movedAt: day(2) },
        ]);
        await tx.query('SELECT pg_sleep(0.05)'); // hold the locks a little while the other one waits
        return out;
      });
    await Promise.all([sell(a, b), sell(b, a), sell(a, b), sell(b, a)]);
    expect(await snapshot(a)).toMatchObject({ qty: '60.0000', layers: '60.0000' });
    expect(await snapshot(b)).toMatchObject({ qty: '60.0000', layers: '60.0000' });
  });
});
