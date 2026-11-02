import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CashAccountBalance, CashCategory, CashTransaction } from '@shared/schemas/cash';
import { startTestApi, type Data, type ErrBody, type ListBody, type TestApi } from '../../../../test/api';

let api: TestApi;
let laci: CashAccountBalance;
let kasToko: CashAccountBalance;
let cats: CashCategory[];
const cat = (code: string) => cats.find((c) => c.code === code)!;

const yesterday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(Date.now() - 86_400_000));

beforeAll(async () => {
  api = await startTestApi();
  const accounts = (await api.call<Data<CashAccountBalance[]>>('GET', '/cash/balances')).body.data;
  laci = accounts.find((a) => a.code === 'LACI')!;
  kasToko = accounts.find((a) => a.code === 'KAS_TOKO')!;
  cats = (await api.call<Data<CashCategory[]>>('GET', '/cash-categories')).body.data;
});
afterAll(async () => {
  await api?.close();
});

const entry = (body: object, as: 'OWNER' | 'KASIR' = 'OWNER') =>
  api.call<Data<CashTransaction> & ErrBody>('POST', '/cash-transactions', body, { as });
const balance = async (code: string, as: 'OWNER' | 'KASIR' = 'OWNER') =>
  (await api.call<Data<CashAccountBalance[]>>('GET', '/cash/balances', undefined, { as })).body.data.find(
    (a) => a.code === code,
  )?.balance;

describe('cash book (FR-FIN-01/02)', () => {
  it('KSIN / KASO get iPOS numbers and move the account balance', async () => {
    const modal = await entry({
      direction: 'IN',
      cashAccountId: kasToko.id,
      categoryId: cat('CAPITAL').id,
      amount: '5000000',
      note: 'Saldo awal kas toko',
    });
    expect(modal.status).toBe(201);
    expect(modal.body.data.number).toMatch(/^0001\/KSIN\/UTM\/\d{4}$/);
    expect(modal.body.data).toMatchObject({ direction: 'IN', amount: '5000000.00', sourceType: 'MANUAL' });

    const bensin = await entry({
      direction: 'OUT',
      cashAccountId: kasToko.id,
      categoryId: cat('OPEX_VEHICLE').id,
      amount: '150000',
      note: 'Solar mobil antar',
      date: yesterday(),
    });
    expect(bensin.status).toBe(201);
    expect(bensin.body.data.number).toMatch(/^0001\/KASO\/UTM\/\d{4}$/);
    expect(await balance('KAS_TOKO')).toBe('4850000.00');
  });

  it('refuses automatic categories, the wrong direction and future dates', async () => {
    const base = { cashAccountId: kasToko.id, amount: '1000', note: 'uji' };
    const auto = await entry({ ...base, direction: 'IN', categoryId: cat('SALES').id });
    expect([auto.status, auto.body.error.code]).toEqual([422, 'CATEGORY_AUTOMATIC']);
    const wrong = await entry({ ...base, direction: 'IN', categoryId: cat('OPEX_WAGES').id });
    expect([wrong.status, wrong.body.error.code]).toEqual([422, 'CATEGORY_DIRECTION']);
    const future = await entry({ ...base, direction: 'OUT', categoryId: cat('OPEX_WAGES').id, date: '2999-01-01' });
    expect([future.status, future.body.error.code]).toEqual([422, 'DATE_IN_FUTURE']);
    const zero = await entry({ ...base, amount: '0', direction: 'OUT', categoryId: cat('OPEX_WAGES').id });
    expect(zero.status).toBe(400);
  });

  it('KASIR: drawer only, today only; sees only the drawer', async () => {
    const out = { direction: 'OUT', categoryId: cat('OPEX_GENERAL').id, amount: '20000', note: 'Beli plastik' };
    const ok = await entry({ ...out, cashAccountId: laci.id }, 'KASIR');
    expect(ok.status).toBe(201);
    const other = await entry({ ...out, cashAccountId: kasToko.id }, 'KASIR');
    expect(other.status).toBe(403);
    const past = await entry({ ...out, cashAccountId: laci.id, date: yesterday() }, 'KASIR');
    expect([past.status, past.body.error.code]).toEqual([422, 'DATE_NOT_ALLOWED']);

    const mine = (await api.call<Data<CashAccountBalance[]>>('GET', '/cash/balances', undefined, { as: 'KASIR' })).body
      .data;
    expect(mine.map((a) => a.code)).toEqual(['LACI']);
    const list = await api.call<ListBody<CashTransaction>>('GET', '/cash-transactions', undefined, { as: 'KASIR' });
    expect(list.body.data.every((t) => t.account.code === 'LACI')).toBe(true);
  });

  it('TRF moves money between accounts in one number; the ledger cannot be edited', async () => {
    await entry({
      direction: 'IN',
      cashAccountId: laci.id,
      categoryId: cat('CAPITAL').id,
      amount: '300000',
      note: 'Modal laci',
    });
    const trf = await api.call<Data<CashTransaction>>(
      'POST',
      '/cash-transfers',
      { fromAccountId: laci.id, toAccountId: kasToko.id, amount: '250000' },
      { as: 'KASIR' },
    );
    expect(trf.status).toBe(201);
    expect(trf.body.data.number).toMatch(/^0001\/TRF\/UTM\/\d{4}$/);
    expect(await balance('LACI')).toBe('30000.00'); // 300.000 − 20.000 − 250.000
    expect(await balance('KAS_TOKO')).toBe('5100000.00');

    const same = await api.call<ErrBody>('POST', '/cash-transfers', {
      fromAccountId: laci.id,
      toAccountId: laci.id,
      amount: '1',
    });
    expect(same.status).toBe(400);
    await expect(api.pool.query('UPDATE cash_transactions SET amount = 1')).rejects.toThrow();
  });

  it('Owner adds expense categories (KASIR 403); built-in ones stay fixed', async () => {
    const add = await api.call<Data<CashCategory> & ErrBody>('POST', '/cash-categories', {
      name: 'Parkir & Retribusi',
      direction: 'OUT',
      isOperatingExpense: true,
    });
    expect(add.status).toBe(201);
    expect(add.body.data).toMatchObject({ code: 'OPEX_PARKIR_RETRIBUSI', manual: true, isOperatingExpense: true });
    const dup = await api.call<ErrBody>('POST', '/cash-categories', { name: 'parkir & retribusi', direction: 'OUT' });
    expect(dup.status).toBe(409);
    const kasir = await api.call('POST', '/cash-categories', { name: 'X', direction: 'OUT' }, { as: 'KASIR' });
    expect(kasir.status).toBe(403);
    const sys = await api.call<ErrBody>('PUT', `/cash-categories/${cat('SALES').id}`, {
      name: 'Jualan',
      direction: 'IN',
    });
    expect([sys.status, sys.body.error.code]).toEqual([422, 'CATEGORY_SYSTEM']);

    const audit = await api.pool.query(`SELECT action FROM audit_logs WHERE action LIKE 'cash%' ORDER BY seq`);
    expect(audit.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(['cash.in', 'cash.out', 'cash.transfer', 'cash_category.create']),
    );
  });
});
