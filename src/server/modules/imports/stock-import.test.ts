// Opening-stock import (sprint-4 C) against the SYNTHETIC iPOS fixture — never the real backup.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ImportBatch, IposStockInspectResult } from '@shared/schemas/imports';
import type { ConsistencyProblem } from '@shared/schemas/stock';
import { uuidv7 } from '@shared/uuid';
import { startTestApi, type Data, type ErrBody, type TestApi } from '../../../../test/api';
import { withTransaction } from '../../db/tx';
import * as stock from '../stock/service';

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi({ ipos: true, hooks: { backup: async (label) => `${label}.dump` } });
});
afterAll(async () => {
  await api?.close();
});

const q = async <T>(sql: string, params: unknown[] = []) => (await api.pool.query(sql, params)).rows as T[];
const productId = async (sku: string) =>
  (await q<{ id: string }>('SELECT id FROM products WHERE sku = $1', [sku]))[0]!.id;

describe('iPOS import — opening stock scope', () => {
  it('needs the master scope first', async () => {
    const r = await api.call<Data<IposStockInspectResult>>('POST', '/imports/ipos/stock/inspect');
    expect(r.body.data.blocker).toContain('Impor data master');
    expect((await api.call<ErrBody>('POST', '/imports/ipos/stock/commit', { purpose: 'DEVELOPMENT' })).status).toBe(
      409,
    );
  });

  it('previews the iPOS stock counted in iPOS itself, with findings', async () => {
    expect((await api.call('POST', '/imports/ipos/commit', { purpose: 'DEVELOPMENT' })).status).toBe(201);
    const r = (await api.call<Data<IposStockInspectResult>>('POST', '/imports/ipos/stock/inspect')).body.data;
    expect(r.blocker).toBeNull();
    expect(r.counts).toEqual({ products: 6, layers: 5, qty: '9019.0000', value: '82395308.64', minusProducts: 1 });
    const issues = Object.fromEntries(r.issues.map((i) => [i.code, i.examples]));
    expect(issues).toEqual({
      STOCK_UNKNOWN_ITEM: ['BARANG HILANG'],
      STOCK_WITHOUT_LAYER: ['BIBIT 01: 5.0000'],
      STOCK_MINUS: ['SP CONTOH: -3.0000'],
    });
  });

  it('copies the open iPOS FIFO layers exactly (cost, date) and reconciles — differences are shown, not hidden', async () => {
    const res = await api.call<Data<ImportBatch>>('POST', '/imports/ipos/stock/commit', { purpose: 'DEVELOPMENT' });
    expect(res.status).toBe(201);
    const batch = res.body.data;
    expect(batch).toMatchObject({ status: 'COMMITTED', scope: ['stock'] });
    const rows = Object.fromEntries(batch.reconciliation.map((r) => [r.label, [r.ipos, r.imported, r.ok]]));
    expect(rows).toEqual({
      'Barang berstok': ['6', '5', false], // BARANG HILANG is not in the master data
      'Lapisan HPP FIFO': ['5', '4', false],
      'Total stok (satuan dasar)': ['9019.0000', '9014.0000', false],
      'Nilai persediaan (HPP FIFO)': ['82395308.64', '82390308.75', false], // −25.000 unknown item, +20.000 BIBIT difference
      'Barang dengan stok minus': ['1', '1', true],
    });

    const urea = await productId('UREA CONTOH');
    expect(
      await q(
        'SELECT received_at, qty_remaining::text AS q, unit_cost::text AS c, source_type AS t FROM stock_cost_layers WHERE product_id = $1 ORDER BY received_at',
        [urea],
      ),
    ).toEqual([
      { received_at: new Date('2026-01-02T01:00:00Z'), q: '1500.0000', c: '7100.0000', t: 'OPENING' },
      { received_at: new Date('2026-02-01T02:30:00Z'), q: '2500.0000', c: '7600.1235', t: 'OPENING' },
    ]);
    // Opening movements happen "as of the backup" (24-10-2026 12:01:26 WIB).
    expect(await q("SELECT DISTINCT moved_at FROM stock_movements WHERE source_type = 'OPENING'")).toEqual([
      { moved_at: new Date('2026-10-24T05:01:26Z') },
    ]);
    // Last purchase cost (S4-4): newest BL layer; RACUN A has no BL → its newest layer.
    expect(
      await q(
        "SELECT sku, last_purchase_cost::text AS c FROM products WHERE sku IN ('UREA CONTOH', 'RACUN A', 'NPK CONTOH 16') ORDER BY sku",
      ),
    ).toEqual([
      { sku: 'NPK CONTOH 16', c: '10400.0000' },
      { sku: 'RACUN A', c: '60000.0000' },
      { sku: 'UREA CONTOH', c: '7600.1235' },
    ]);
    expect(
      await q(
        "SELECT p.sku, b.qty::text AS qty FROM stock_balances b JOIN products p ON p.id = b.product_id WHERE p.sku IN ('SP CONTOH', 'BIBIT 01') ORDER BY 1",
      ),
    ).toEqual([
      { sku: 'BIBIT 01', qty: '5.0000' },
      { sku: 'SP CONTOH', qty: '-3.0000' },
    ]);
    expect(
      (await q<{ n: number }>("SELECT count(*)::int AS n FROM legacy_refs WHERE entity = 'stock_layer'"))[0],
    ).toEqual({ n: 4 });
    expect((await api.call<Data<ConsistencyProblem[]>>('GET', '/stock/consistency')).body.data).toEqual([]);
  });

  it('FIFO continues where iPOS stopped: the next sale uses the oldest iPOS layer first', async () => {
    const urea = await productId('UREA CONTOH');
    const wh = (await q<{ id: string }>("SELECT id FROM warehouses WHERE code = 'UTM'"))[0]!.id;
    const [sale] = await withTransaction(api.pool, (tx) =>
      stock.apply(tx, [
        { productId: urea, warehouseId: wh, qty: '-1600', sourceType: 'SALE', sourceId: uuidv7(), movedAt: new Date() },
      ]),
    );
    // (1.500 × 7.100 + 100 × 7.600,1235) / 1.600
    expect(sale!.unitCost).toBe('7131.2577');
  });

  it('refuses a second stock import, and a reset clears stock & numbering for a fresh import', async () => {
    expect(
      (await api.call<ErrBody>('POST', '/imports/ipos/stock/commit', { purpose: 'DEVELOPMENT' })).body.error.code,
    ).toBe('IMPORT_NOT_ALLOWED');
    await api.pool.query(
      "INSERT INTO doc_sequences (doc_type, dept_code, year, last_no) VALUES ('PS', 'UTM', 2026, 7)",
    );
    expect((await api.call('POST', '/imports/reset', { confirm: 'RESET' })).status).toBe(200);
    expect(
      await q(
        'SELECT (SELECT count(*) FROM stock_movements)::int AS m, (SELECT count(*) FROM stock_balances)::int AS b, (SELECT count(*) FROM doc_sequences)::int AS s',
      ),
    ).toEqual([{ m: 0, b: 0, s: 0 }]);
    expect((await api.call('POST', '/imports/ipos/commit', { purpose: 'REHEARSAL' })).status).toBe(201);
    expect((await api.call('POST', '/imports/ipos/stock/commit', { purpose: 'REHEARSAL' })).status).toBe(201);
  });

  it('is Owner-only', async () => {
    expect((await api.call('POST', '/imports/ipos/stock/inspect', undefined, { as: 'KASIR' })).status).toBe(403);
    expect(
      (await api.call('POST', '/imports/ipos/stock/commit', { purpose: 'DEVELOPMENT' }, { as: 'KASIR' })).status,
    ).toBe(403);
  });
});
