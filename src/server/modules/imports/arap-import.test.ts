// Open receivables & payables import (sprint-9 A7) against the SYNTHETIC iPOS fixture — never the real backup.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ImportBatch, IposArApInspectResult } from '@shared/schemas/imports';
import { startTestApi, type Data, type ErrBody, type TestApi } from '../../../../test/api';

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi({ ipos: true, hooks: { backup: async (label) => `${label}.dump` } });
});
afterAll(async () => {
  await api?.close();
});

const inspect = async () =>
  (await api.call<Data<IposArApInspectResult>>('POST', '/imports/ipos/receivables/inspect')).body.data;
const commit = (body: object) =>
  api.call<Data<ImportBatch> & ErrBody>('POST', '/imports/ipos/receivables/commit', {
    purpose: 'DEVELOPMENT',
    ...body,
  });

describe('iPOS import — open receivables & payables scope', () => {
  it('needs the master scope first', async () => {
    expect((await inspect()).blocker).toContain('Impor data master');
    expect((await commit({})).status).toBe(409);
  });

  it('previews iPOS credit left, findings, and the credit purchases to tick', async () => {
    expect((await api.call('POST', '/imports/ipos/commit', { purpose: 'DEVELOPMENT' })).status).toBe(201);
    const r = await inspect();
    expect(r.blocker).toBeNull();
    expect(r.counts).toEqual({
      receivables: 3,
      receivablesOpen: '6750000.00',
      customers: 3,
      payables: 2,
      payablesOpen: '55000000.00',
    });
    expect(Object.fromEntries(r.issues.map((i) => [i.code, i.examples]))).toEqual({
      AR_UNKNOWN_CUSTOMER: ['0000004/JL/UTM/0226 (PL0404)'],
      AR_NO_DUE_DATE: ['0000003/JL/UTM/0226'],
    });
    expect(r.payables).toEqual([
      {
        legacyKey: '0000001/BL/UTM/0126',
        supplierCode: 'SP0001',
        supplierName: 'CV Contoh Agro',
        docDate: '2026-01-02',
        dueDate: '2026-01-12',
        open: '52000000.00',
      },
      expect.objectContaining({ legacyKey: '0000002/BL/UTM/0226', supplierName: 'CV Kode Nama', open: '3000000.00' }),
    ]);
  });

  it('refuses ticks that are not iPOS credit purchases or above what iPOS says is open', async () => {
    expect((await commit({ payables: [{ legacyKey: 'BUKAN', amount: '1' }] })).body.error.code).toBe(
      'IMPORT_PAYABLE_INVALID',
    );
    expect(
      (await commit({ payables: [{ legacyKey: '0000002/BL/UTM/0226', amount: '3000001' }] })).body.error.code,
    ).toBe('IMPORT_PAYABLE_TOO_MUCH');
  });

  it('imports every open note as OPENING with its own number and dates, ticked debts only, and reconciles', async () => {
    const r = await commit({ payables: [{ legacyKey: '0000002/BL/UTM/0226', amount: '1000000' }] });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ status: 'COMMITTED', scope: ['receivables'] });
    expect(Object.fromEntries(r.body.data.reconciliation.map((x) => [x.label, [x.ipos, x.imported, x.ok]]))).toEqual({
      'Nota piutang terbuka': ['3', '2', false], // the unknown customer is shown, not hidden
      'Total sisa piutang': ['6750000.00', '6500000.00', false],
      'Pelanggan berpiutang': ['3', '2', false],
      'Faktur hutang dicentang': ['2', '1', true],
      'Total hutang dicentang': ['55000000.00', '1000000.00', true],
    });
    const rec = await api.pool.query(
      `SELECT r.doc_number, r.doc_date::text, r.due_date::text, r.amount::text, r.paid_amount::text, r.source_type, c.name
       FROM receivables r JOIN customers c ON c.id = r.customer_id ORDER BY r.doc_number`,
    );
    expect(rec.rows).toEqual([
      {
        doc_number: '0000001/JL/UTM/0126',
        doc_date: '2026-01-06',
        due_date: '2026-01-16',
        amount: '5000000.00',
        paid_amount: '0.00',
        source_type: 'OPENING',
        name: 'Tani Contoh Satu',
      },
      {
        doc_number: '0000003/JL/UTM/0226',
        doc_date: '2026-02-03',
        due_date: '2026-02-03', // no due date in iPOS → the note date
        amount: '1500000.00',
        paid_amount: '0.00',
        source_type: 'OPENING',
        name: 'Kebun Contoh',
      },
    ]);
    const pay = await api.pool.query(`SELECT doc_number, amount::text FROM payables`);
    expect(pay.rows).toEqual([{ doc_number: '0000002/BL/UTM/0226', amount: '1000000.00' }]);
    const refs = await api.pool.query(
      `SELECT entity, count(*)::int AS n FROM legacy_refs WHERE entity IN ('receivable','payable') GROUP BY 1 ORDER BY 1`,
    );
    expect(refs.rows).toEqual([
      { entity: 'payable', n: 1 },
      { entity: 'receivable', n: 2 },
    ]);
  });

  it('refuses a second import; a reset allows a fresh one; Owner-only', async () => {
    expect((await inspect()).blocker).toContain('sudah diimpor');
    expect((await commit({})).status).toBe(409);
    expect((await api.call('POST', '/imports/ipos/receivables/inspect', undefined, { as: 'KASIR' })).status).toBe(403);
    expect((await api.call('POST', '/imports/reset', { confirm: 'RESET' })).status).toBe(200);
    expect((await api.pool.query(`SELECT 1 FROM receivables`)).rowCount).toBe(0);
  });
});
