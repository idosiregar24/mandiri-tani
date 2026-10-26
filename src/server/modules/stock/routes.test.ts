import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Product, Unit } from '@shared/schemas/master';
import type {
  Adjustment,
  ConsistencyProblem,
  CostLayer,
  Opname,
  StockCard,
  StockRow,
  StockSummary,
} from '@shared/schemas/stock';
import { uuidv7 } from '@shared/uuid';
import { startTestApi, type Data, type ErrBody, type TestApi } from '../../../../test/api';
import { withTransaction } from '../../db/tx';
import { clock } from '../../lib/clock';
import { formatDocNumber } from '../../lib/numbering';
import * as stock from './service';

let api: TestApi;
let urea: Product;
let wh: string;
const kgOf = (p: Product) => p.units.find((u) => u.unitCode === 'KG')!.id;
const zakOf = (p: Product) => p.units.find((u) => u.unitCode === 'ZAK')!.id;
type StockList = { data: StockRow[]; meta: { total: number; summary: StockSummary } };

beforeAll(async () => {
  api = await startTestApi();
  const units = (await api.call<Data<Unit[]>>('GET', '/units')).body.data;
  const unit = (code: string) => units.find((u) => u.code === code)!.id;
  urea = (
    await api.call<Data<Product>>('POST', '/products', {
      name: 'Urea Uji Stok',
      units: [
        { unitId: unit('KG'), conversionQty: '1', isBase: true, prices: [{ price: '15000' }] },
        { unitId: unit('ZAK'), conversionQty: '50', isBase: false, isDefaultSale: true, prices: [{ price: '640000' }] },
      ],
    })
  ).body.data;
  wh = (await api.pool.query<{ id: string }>("SELECT id FROM warehouses WHERE code = 'UTM'")).rows[0]!.id;
  // 100 ZAK in stock at 7.100/kg (as if received from a supplier).
  await withTransaction(api.pool, (tx) =>
    stock.apply(tx, [
      {
        productId: urea.id,
        warehouseId: wh,
        qty: '5000',
        unitCost: '7100',
        sourceType: 'PURCHASE_RECEIPT',
        sourceId: uuidv7(),
        movedAt: new Date(),
      },
    ]),
  );
});
afterAll(async () => {
  await api?.close();
});

const number = (type: 'PS' | 'OP', n: number) => formatDocNumber(n, type, 'UTM', clock.now());

describe('stock list & card', () => {
  it('shows physical / reserved / available and — for the Owner only — FIFO value', async () => {
    const owner = await api.call<StockList>('GET', '/stock?q=urea uji');
    expect(owner.body.data[0]).toMatchObject({
      qty: '5000.0000',
      reservedQty: '0.0000',
      availableQty: '5000.0000',
      saleUnitCode: 'ZAK',
      saleConversion: '50',
      value: '35500000.00',
      avgCost: '7100.0000',
    });
    expect(owner.body.meta.summary.totalValue).toBe('35500000.00');

    const kasir = await api.call<StockList>('GET', '/stock?q=urea uji', undefined, { as: 'KASIR' });
    expect(kasir.status).toBe(200);
    expect(kasir.body.data[0]).not.toHaveProperty('value');
    expect(kasir.body.data[0]).not.toHaveProperty('avgCost');
    expect(kasir.body.meta.summary).not.toHaveProperty('totalValue');
    expect((await api.call('GET', `/stock/${urea.id}/layers`, undefined, { as: 'KASIR' })).status).toBe(403);
  });

  it('lists the open FIFO layers for the Owner', async () => {
    const r = await api.call<Data<CostLayer[]>>('GET', `/stock/${urea.id}/layers`);
    expect(r.body.data).toEqual([
      expect.objectContaining({
        qtyRemaining: '5000.0000',
        unitCost: '7100.0000',
        value: '35500000.00',
        sourceType: 'PURCHASE_RECEIPT',
      }),
    ]);
  });
});

describe('stock adjustments (PS)', () => {
  it('books a damaged-goods adjustment in ZAK as base-unit movements with a PS number and an audit row', async () => {
    const key = uuidv7();
    const body = {
      reasonCode: 'DAMAGED',
      note: 'karung sobek',
      lines: [{ productId: urea.id, productUnitId: zakOf(urea), qty: '-2' }],
    };
    const res = await fetchWithKey(body, key);
    expect(res.status).toBe(201);
    const adj = res.body.data;
    expect(adj).toMatchObject({ number: number('PS', 1), reasonCode: 'DAMAGED', lineCount: 1, value: '-710000.00' });
    expect(adj.lines![0]).toMatchObject({ qty: '-100.0000', unitCost: '7100.0000', baseUnitCode: 'KG' });

    // Same Idempotency-Key → same document, no second movement.
    const again = await fetchWithKey(body, key);
    expect(again.body.data.id).toBe(adj.id);
    const stockNow = await api.call<StockList>('GET', '/stock?q=urea uji');
    expect(stockNow.body.data[0]!.qty).toBe('4900.0000');
    const audit = await api.pool.query(
      "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'stock.adjust' AND entity_id = $1",
      [adj.id],
    );
    expect(audit.rows[0]).toEqual({ n: 1 });
  });

  it('shows the adjustment on the stock card with its number and a running balance', async () => {
    const card = (await api.call<Data<StockCard>>('GET', `/stock/${urea.id}/card`)).body.data;
    expect(card).toMatchObject({ opening: '0.0000', totalIn: '5000.0000', totalOut: '100.0000', closing: '4900.0000' });
    expect(card.lines.map((l) => [l.document, l.qtyIn, l.qtyOut, l.balance])).toEqual([
      ['PURCHASE_RECEIPT', '5000.0000', '0.0000', '5000.0000'],
      [number('PS', 1), '0.0000', '100.0000', '4900.0000'],
    ]);
    const kasir = (await api.call<Data<StockCard>>('GET', `/stock/${urea.id}/card`, undefined, { as: 'KASIR' })).body
      .data;
    expect(kasir.lines[0]).not.toHaveProperty('unitCost');
  });

  it('validates reason, decimals in the typed unit, and stock (400 / 422 / 409)', async () => {
    const other = await api.call<ErrBody>('POST', '/stock/adjustments', {
      reasonCode: 'OTHER',
      lines: [{ productId: urea.id, productUnitId: zakOf(urea), qty: '1' }],
    });
    expect(other.status).toBe(400);
    expect(other.body.error.details?.fieldErrors?.note).toContain('Lainnya');
    const half = await api.call<ErrBody>('POST', '/stock/adjustments', {
      reasonCode: 'LOST',
      lines: [{ productId: urea.id, productUnitId: kgOf(urea), qty: '-0.5' }],
    });
    expect(half.body.error.code).toBe('DECIMAL_NOT_ALLOWED');
    const tooMuch = await api.call<ErrBody>('POST', '/stock/adjustments', {
      reasonCode: 'LOST',
      lines: [{ productId: urea.id, productUnitId: zakOf(urea), qty: '-500' }],
    });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.message).toBe(
      'Stok fisik Urea Uji Stok tinggal 98 zak. Kurangi jumlahnya atau minta PIN Owner.',
    );
  });

  it('is Owner-only', async () => {
    expect((await api.call('GET', '/stock/adjustments', undefined, { as: 'KASIR' })).status).toBe(403);
    expect((await api.call('POST', '/stock/adjustments', {}, { as: 'KASIR' })).status).toBe(403);
    expect((await api.call('GET', '/stock', undefined, { as: 'ANONYMOUS' })).status).toBe(401);
  });
});

const fetchWithKey = (body: unknown, key: string) =>
  api.call<Data<Adjustment>>('POST', '/stock/adjustments', body, { headers: { 'idempotency-key': key } });

describe('stock opname (OP)', () => {
  it('counts in any unit, takes the system qty at POSTING (sales during the session count), books the difference', async () => {
    const created = await api.call<Data<Opname>>('POST', '/stock/opnames', { note: 'opname akhir bulan' });
    expect(created.status).toBe(201);
    const op = created.body.data;
    expect(op).toMatchObject({ number: number('OP', 1), status: 'COUNTING', lineCount: 0 });

    // Counted 97 ZAK = 4.850 kg while the system says 4.900.
    const counted = await api.call<Data<Opname>>('PUT', `/stock/opnames/${op.id}/lines`, {
      productId: urea.id,
      productUnitId: zakOf(urea),
      countedQty: '97',
    });
    expect(counted.body.data.lines![0]).toMatchObject({
      countedQty: '4850.0000',
      systemQty: '4900.0000',
      diffQty: '-50.0000',
    });

    // A sale of 1 ZAK happens before posting → system 4.850 → no difference left.
    await withTransaction(api.pool, (tx) =>
      stock.apply(tx, [
        {
          productId: urea.id,
          warehouseId: wh,
          qty: '-50',
          sourceType: 'SALE',
          sourceId: uuidv7(),
          movedAt: new Date(),
        },
      ]),
    );
    const posted = await api.call<Data<Opname>>('POST', `/stock/opnames/${op.id}/post`);
    expect(posted.body.data).toMatchObject({ status: 'POSTED', diffValue: '0.00' });
    expect(posted.body.data.lines![0]).toMatchObject({ systemQty: '4850.0000', diffQty: '0.0000' });

    expect((await api.call<ErrBody>('POST', `/stock/opnames/${op.id}/post`)).body.error.code).toBe('OPNAME_CLOSED');
    expect(
      (
        await api.call<ErrBody>('PUT', `/stock/opnames/${op.id}/lines`, {
          productId: urea.id,
          productUnitId: kgOf(urea),
          countedQty: '1',
        })
      ).status,
    ).toBe(409);
  });

  it('books a shortage as an OPNAME outflow at FIFO cost and a surplus at the last purchase cost', async () => {
    const op = (await api.call<Data<Opname>>('POST', '/stock/opnames', {})).body.data;
    await api.call('PUT', `/stock/opnames/${op.id}/lines`, {
      productId: urea.id,
      productUnitId: kgOf(urea),
      countedQty: '4800',
    });
    const posted = (await api.call<Data<Opname>>('POST', `/stock/opnames/${op.id}/post`)).body.data;
    expect(posted.lines![0]).toMatchObject({ diffQty: '-50.0000', unitCost: '7100.0000', diffValue: '-355000.00' });
    expect(posted.diffValue).toBe('-355000.00');
    const card = (await api.call<Data<StockCard>>('GET', `/stock/${urea.id}/card`)).body.data;
    expect(card.lines.at(-1)).toMatchObject({ document: number('OP', 2), qtyOut: '50.0000', balance: '4800.0000' });
  });

  it('refuses to post an empty session, can cancel, and is Owner-only', async () => {
    const op = (await api.call<Data<Opname>>('POST', '/stock/opnames', {})).body.data;
    expect((await api.call<ErrBody>('POST', `/stock/opnames/${op.id}/post`)).body.error.code).toBe('OPNAME_EMPTY');
    expect((await api.call<Data<Opname>>('POST', `/stock/opnames/${op.id}/cancel`)).body.data.status).toBe('CANCELLED');
    expect((await api.call('GET', '/stock/opnames', undefined, { as: 'KASIR' })).status).toBe(403);
  });

  it('keeps ledger, balances and layers consistent (G-4)', async () => {
    expect((await api.call<Data<ConsistencyProblem[]>>('GET', '/stock/consistency')).body.data).toEqual([]);
  });
});
