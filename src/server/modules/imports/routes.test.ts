// Importer, master scope, against the SYNTHETIC iPOS fixture (test/fixtures/ipos-mini.sql) —
// never the store's real backup (CLAUDE.md #13).
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ImportBatch, IposInspectResult, ResetResult } from '@shared/schemas/imports';
import { startTestApi, type Data, type ErrBody, type TestApi } from '../../../../test/api';

let api: TestApi;
const backups: string[] = [];

beforeAll(async () => {
  api = await startTestApi({
    ipos: true,
    hooks: {
      backup: async (label) => {
        backups.push(label);
        return `C:\\data\\backups\\${label}-2026-10-26.dump`;
      },
    },
  });
});
afterAll(async () => {
  await api?.close();
});

const one = async <T>(sql: string, params: unknown[] = []) => (await api.pool.query(sql, params)).rows[0] as T;
const all = async <T>(sql: string, params: unknown[] = []) => (await api.pool.query(sql, params)).rows as T[];

describe('iPOS import — master scope', () => {
  it('previews counts and data-quality findings without writing anything', async () => {
    const res = await api.call<Data<IposInspectResult>>('POST', '/imports/ipos/inspect');
    expect(res.status).toBe(200);
    const r = res.body.data;
    expect(r.source).toMatchObject({
      fileName: 'contoh.i5bu',
      sourceVersion: '9.5.3',
      dumpCreatedAt: '2026-10-24 12:01:26',
    });
    expect(r.fingerprint).toEqual([]);
    expect(r.blocker).toBeNull();
    expect(r.counts).toEqual({
      units: 7,
      categories: 4,
      customerGroups: 3,
      customers: 6,
      suppliers: 2,
      bankAccounts: 2,
      products: 8,
      multiUnitProducts: 3,
      derivedUnits: 3,
      pricedUnits: 8,
    });
    const codes = Object.fromEntries(r.issues.map((i) => [i.code, i]));
    expect(codes['DQ-5']).toMatchObject({ count: 1, examples: ['Pak Kode Nama → PL0010'] });
    expect(codes['DQ-5S']).toMatchObject({ count: 1, examples: ['CV KODE NAMA → SP0002'] });
    expect(codes['DQ-4']?.examples[0]).toContain('PL0001, PL0003');
    expect(codes['DQ-2']).toMatchObject({ count: 1, examples: ['RACUN CONTOH B 1 LTR'] });
    expect(codes['UNIT_CONV_1']?.count).toBe(1);
    expect(codes['ITEM_TYPE']?.count).toBe(1);
    expect(codes['DQ-9']?.examples).toEqual(['PUPUK SP CONTOH']);
    expect(await one<{ n: number }>('SELECT count(*)::int AS n FROM products')).toEqual({ n: 0 });
  });

  it('imports everything in one transaction and reconciles 1:1 with iPOS', async () => {
    const res = await api.call<Data<ImportBatch>>('POST', '/imports/ipos/commit', { purpose: 'DEVELOPMENT' });
    expect(res.status).toBe(201);
    const batch = res.body.data;
    expect(batch).toMatchObject({
      status: 'COMMITTED',
      purpose: 'DEVELOPMENT',
      scope: ['master'],
      sourceFile: 'contoh.i5bu',
    });
    expect(batch.sourceDumpAt).toBeTruthy();
    for (const row of batch.reconciliation) expect(row.imported, row.label).toBe(row.ipos);
    expect(batch.reconciliation.find((r) => r.label === 'Pelanggan grup RAM_1')).toEqual({
      label: 'Pelanggan grup RAM_1',
      ipos: 1,
      imported: 1,
    });

    const audit = await one<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'import.ipos.commit' AND entity_id = $1",
      [batch.id],
    );
    expect(audit.n).toBe(1);
  });

  it('maps pupuk KG + ZAK = 50 KG with type-S prices and the usual sale/purchase unit (S3-5, S3-7)', async () => {
    const units = await all<{
      sku: string;
      code: string;
      conv: string;
      base: boolean;
      sale: boolean;
      buy: boolean;
      price: string | null;
    }>(
      `SELECT p.sku, u.code, trim_scale(pu.conversion_qty)::text AS conv, pu.is_base AS base, pu.is_default_sale AS sale,
              pu.is_default_purchase AS buy, pp.price::text AS price
       FROM products p JOIN product_units pu ON pu.product_id = p.id JOIN units u ON u.id = pu.unit_id
       LEFT JOIN product_prices pp ON pp.product_unit_id = pu.id AND pp.deleted_at IS NULL
       WHERE p.sku IN ('UREA CONTOH', 'NPK CONTOH 16', 'BIBIT 01') ORDER BY p.sku, pu.conversion_qty`,
    );
    expect(units).toEqual([
      { sku: 'BIBIT 01', code: 'PCS', conv: '1', base: true, sale: true, buy: true, price: '5000.00' },
      // NPK: KG price 0 is not imported; usual purchase unit = ZAK (from tbl_imdt).
      { sku: 'NPK CONTOH 16', code: 'KG', conv: '1', base: true, sale: true, buy: false, price: null },
      { sku: 'NPK CONTOH 16', code: 'ZAK', conv: '50', base: false, sale: false, buy: true, price: '700000.00' },
      // UREA: tbl_itemhj prices (not hargajual1 = 9999), level-2 tier ignored; sold mostly per ZAK.
      { sku: 'UREA CONTOH', code: 'KG', conv: '1', base: true, sale: false, buy: false, price: '15000.00' },
      { sku: 'UREA CONTOH', code: 'ZAK', conv: '50', base: false, sale: true, buy: true, price: '640000.00' },
    ]);
    const cat = await all<{ name: string }>('SELECT name FROM categories ORDER BY name');
    expect(cat.map((c) => c.name)).toEqual(['Alat Pertanian', 'Bibit', 'Pestisida', 'Pupuk']);
    expect(await one('SELECT name FROM units WHERE code = $1', ['IKAT'])).toEqual({ name: 'Ikat' });
    expect(
      await one(
        "SELECT b.barcode FROM product_barcodes b JOIN product_units pu ON pu.id = b.product_unit_id JOIN products p ON p.id = pu.product_id WHERE p.sku = 'RACUN A'",
      ),
    ).toEqual({
      barcode: '8990000000017',
    });
  });

  it('maps customers, groups, suppliers and banks (D-6, D-7, DQ-5)', async () => {
    const customers = await all<{
      code: string;
      phone: string | null;
      group: string;
      limit: string | null;
      term: number;
      active: boolean;
      walkin: boolean;
    }>(
      `SELECT c.code, c.phone, g.code AS group, c.credit_limit::text AS limit, c.payment_term_days AS term, c.is_active AS active, c.is_walk_in AS walkin
       FROM customers c JOIN customer_groups g ON g.id = c.customer_group_id ORDER BY c.code`,
    );
    expect(customers).toEqual([
      { code: 'PL0001', phone: '081200000001', group: 'UMUM', limit: null, term: 10, active: true, walkin: false },
      { code: 'PL0003', phone: null, group: 'GOLD', limit: null, term: 10, active: true, walkin: false },
      { code: 'PL0007', phone: null, group: 'RAM_1', limit: '5000000.00', term: 14, active: true, walkin: false },
      { code: 'PL0009', phone: null, group: 'UMUM', limit: null, term: 10, active: false, walkin: false },
      { code: 'PL0010', phone: null, group: 'UMUM', limit: null, term: 10, active: true, walkin: false },
      // iPOS "UMUM" became the built-in walk-in customer, not a second UMUM.
      { code: 'UMUM', phone: null, group: 'UMUM', limit: '0.00', term: 10, active: true, walkin: true },
    ]);
    expect(await one("SELECT address FROM customers WHERE code = 'PL0007'")).toEqual({
      address: 'Desa Contoh, Kota Contoh',
    });
    expect(
      await one<{ n: number }>(
        "SELECT count(*)::int AS n FROM legacy_refs WHERE entity = 'customer' AND legacy_key = 'UMUM'",
      ),
    ).toEqual({ n: 1 });
    expect(await all('SELECT code, discount_percent::text AS d FROM customer_groups ORDER BY code')).toEqual([
      { code: 'GOLD', d: '10.00' },
      { code: 'RAM_1', d: '0.00' },
      { code: 'UMUM', d: '0.00' },
    ]);
    expect(await all('SELECT code, contact_name, payment_term_days AS term FROM suppliers ORDER BY code')).toEqual([
      { code: 'SP0001', contact_name: 'Bu Contoh', term: 0 },
      { code: 'SP0002', contact_name: null, term: 30 },
    ]);
    expect(
      await all(
        "SELECT m.code, m.name, a.code AS account FROM payment_methods m JOIN cash_accounts a ON a.id = m.cash_account_id WHERE m.kind = 'TRANSFER' ORDER BY m.code",
      ),
    ).toEqual([
      { code: 'TRANSFER_BCA', name: 'Transfer BCA', account: 'BANK_BCA' },
      { code: 'TRANSFER_MANDIRI', name: 'Transfer Mandiri', account: 'BANK_MANDIRI' },
    ]);
  });

  it('refuses to import the same scope twice (FR-MIG-03) and lists the batch', async () => {
    const again = await api.call<ErrBody>('POST', '/imports/ipos/commit', { purpose: 'DEVELOPMENT' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('IMPORT_NOT_ALLOWED');
    const inspect = await api.call<Data<IposInspectResult>>('POST', '/imports/ipos/inspect');
    expect(inspect.body.data.blocker).toContain('Reset data persiapan');
    const list = await api.call<Data<ImportBatch[]>>('GET', '/imports/batches');
    expect(list.body.data.map((b) => b.status)).toEqual(['COMMITTED']);
  });

  it('resets the preparation data after an automatic backup, then imports again (FR-MIG-08)', async () => {
    expect((await api.call<ErrBody>('POST', '/imports/reset', { confirm: 'hapus' })).status).toBe(400);
    expect(backups).toEqual([]);

    const res = await api.call<Data<ResetResult>>('POST', '/imports/reset', { confirm: 'RESET' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ backupFile: 'pre-reset-2026-10-26.dump', discardedBatches: 1 });
    expect(backups).toEqual(['pre-reset']);
    expect(
      await one(
        'SELECT (SELECT count(*) FROM products)::int AS p, (SELECT count(*) FROM legacy_refs)::int AS r, (SELECT count(*) FROM customers)::int AS c',
      ),
    ).toEqual({
      p: 0,
      r: 0,
      c: 1, // walk-in seeded again
    });
    expect(await one<{ n: number }>("SELECT count(*)::int AS n FROM units WHERE code = 'IKAT'")).toEqual({ n: 0 });
    expect(
      await one<{ n: number }>("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'system.reset_preparation'"),
    ).toEqual({ n: 1 });

    const again = await api.call<Data<ImportBatch>>('POST', '/imports/ipos/commit', { purpose: 'REHEARSAL' });
    expect(again.status).toBe(201);
    const list = await api.call<Data<ImportBatch[]>>('GET', '/imports/batches');
    expect(list.body.data.map((b) => [b.purpose, b.status])).toEqual([
      ['REHEARSAL', 'COMMITTED'],
      ['DEVELOPMENT', 'DISCARDED'],
    ]);
  });

  it('refuses reset and import once the store is live', async () => {
    await api.pool.query(
      `INSERT INTO settings (key, value) VALUES ('system', '{"go_live_at": "2026-11-01T00:00:00+07:00"}')`,
    );
    try {
      expect((await api.call<ErrBody>('POST', '/imports/reset', { confirm: 'RESET' })).body.error.code).toBe(
        'ALREADY_LIVE',
      );
      expect((await api.call<Data<IposInspectResult>>('POST', '/imports/ipos/inspect')).body.data.blocker).toContain(
        'go-live',
      );
    } finally {
      await api.pool.query("DELETE FROM settings WHERE key = 'system'");
    }
  });

  it('stops with a clear list when the backup structure differs (FR-MIG-09)', async () => {
    const c = new pg.Client(api.iposDb!);
    await c.connect();
    await c.query('ALTER TABLE tbl_item RENAME COLUMN sistemhargajual TO sistem_harga');
    await c.query('ALTER TABLE tbl_bank RENAME TO tbl_bank_lama');
    try {
      const r = (await api.call<Data<IposInspectResult>>('POST', '/imports/ipos/inspect')).body.data;
      expect(r.fingerprint).toEqual([
        { table: 'tbl_item', missingColumns: ['sistemhargajual'] },
        { table: 'tbl_bank', missingColumns: [] },
      ]);
      expect(r.counts).toBeNull();
      expect(r.blocker).toContain('Struktur backup');
      const commit = await api.call<ErrBody>('POST', '/imports/ipos/commit', { purpose: 'DEVELOPMENT' });
      expect(commit.status).toBe(422);
      expect(commit.body.error.code).toBe('IPOS_STRUCTURE_MISMATCH');
    } finally {
      await c.query('ALTER TABLE tbl_item RENAME COLUMN sistem_harga TO sistemhargajual');
      await c.query('ALTER TABLE tbl_bank_lama RENAME TO tbl_bank');
      await c.end();
    }
  });

  it('is Owner-only (403 for KASIR, 401 without the key)', async () => {
    for (const [method, path, body] of [
      ['POST', '/imports/ipos/inspect', undefined],
      ['POST', '/imports/ipos/commit', { purpose: 'DEVELOPMENT' }],
      ['GET', '/imports/batches', undefined],
      ['POST', '/imports/reset', { confirm: 'RESET' }],
    ] as const) {
      expect((await api.call(method, path, body, { as: 'KASIR' })).status, `${method} ${path}`).toBe(403);
      expect((await api.call(method, path, body, { as: 'ANONYMOUS' })).status).toBe(401);
    }
  });
});

describe('iPOS import before a backup was chosen', () => {
  let bare: TestApi;
  beforeAll(async () => {
    bare = await startTestApi();
  });
  afterAll(async () => {
    await bare?.close();
  });

  it('asks the owner to pick a file first (409)', async () => {
    const r = await bare.call<ErrBody>('POST', '/imports/ipos/inspect');
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('IPOS_SOURCE_MISSING');
  });

  it('refuses to reset without a backup hook (503) — never wipes without a backup', async () => {
    const r = await bare.call<ErrBody>('POST', '/imports/reset', { confirm: 'RESET' });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('BACKUP_UNAVAILABLE');
  });
});
