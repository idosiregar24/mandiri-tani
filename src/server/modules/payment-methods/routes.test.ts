import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CashAccount, PaymentMethod } from '@shared/schemas/master';
import { startTestApi, type Data, type ErrBody, type TestApi } from '../../../../test/api';

let api: TestApi;

beforeAll(async () => {
  api = await startTestApi();
});
afterAll(async () => {
  await api?.close();
});

describe('bank accounts & payment methods (D-6)', () => {
  it('seeds LACI / KAS_TOKO and the built-in Tunai & Piutang', async () => {
    const accounts = await api.call<Data<CashAccount[]>>('GET', '/cash-accounts');
    expect(accounts.body.data.map((a) => a.code).sort()).toEqual(['KAS_TOKO', 'LACI']);
    const methods = await api.call<Data<PaymentMethod[]>>('GET', '/payment-methods');
    expect(methods.body.data.map((m) => [m.code, m.isBuiltIn])).toEqual([
      ['CASH', true],
      ['CREDIT', true],
    ]);
  });

  it('creates a bank account and a TRANSFER method into it', async () => {
    const bca = await api.call<Data<CashAccount>>('POST', '/cash-accounts', { code: 'bank_bca', name: 'BCA Toko' });
    expect(bca.body.data).toMatchObject({ code: 'BANK_BCA', kind: 'BANK' });
    const m = await api.call<Data<PaymentMethod>>('POST', '/payment-methods', {
      code: 'TRANSFER_BCA',
      name: 'Transfer BCA',
      kind: 'TRANSFER',
      cashAccountId: bca.body.data.id,
      accountNumber: '1234567890',
      accountHolder: 'Mandiri Tani',
    });
    expect(m.status).toBe(201);
    expect(m.body.data).toMatchObject({ cashAccountName: 'BCA Toko', accountNumber: '1234567890', isBuiltIn: false });

    // The account is now in use and cannot be removed before its method.
    const del = await api.call<ErrBody>('DELETE', `/cash-accounts/${bca.body.data.id}`);
    expect(del.body.error.code).toBe('REFERENCE_IN_USE');
    expect((await api.call('DELETE', `/payment-methods/${m.body.data.id}`)).status).toBe(204);
    expect((await api.call('DELETE', `/cash-accounts/${bca.body.data.id}`)).status).toBe(204);
  });

  it('refuses transfer into the drawer, and protects built-ins', async () => {
    const accounts = (await api.call<Data<CashAccount[]>>('GET', '/cash-accounts')).body.data;
    const laci = accounts.find((a) => a.code === 'LACI')!;
    const intoDrawer = await api.call<ErrBody>('POST', '/payment-methods', {
      code: 'QRIS',
      name: 'QRIS',
      kind: 'QRIS',
      cashAccountId: laci.id,
    });
    expect(intoDrawer.body.error.code).toBe('INVALID_ACCOUNT');
    expect(
      (await api.call<ErrBody>('PUT', `/cash-accounts/${laci.id}`, { code: 'LACI', name: 'X' })).body.error.code,
    ).toBe('BUILT_IN');

    const cash = (await api.call<Data<PaymentMethod[]>>('GET', '/payment-methods')).body.data.find(
      (m) => m.code === 'CASH',
    )!;
    expect((await api.call<ErrBody>('DELETE', `/payment-methods/${cash.id}`)).body.error.code).toBe('BUILT_IN');
    // Only the label and order of a built-in method can change.
    const renamed = await api.call<Data<PaymentMethod>>('PUT', `/payment-methods/${cash.id}`, {
      name: 'Uang Tunai',
      sortOrder: 2,
      kind: 'QRIS',
    });
    expect(renamed.body.data).toMatchObject({ code: 'CASH', kind: 'CASH', name: 'Uang Tunai', sortOrder: 2 });
  });

  it('lets KASIR read methods but not change them (403)', async () => {
    expect((await api.call('GET', '/payment-methods', undefined, { as: 'KASIR' })).status).toBe(200);
    expect((await api.call('POST', '/cash-accounts', { code: 'X', name: 'X' }, { as: 'KASIR' })).status).toBe(403);
    expect((await api.call('GET', '/payment-methods', undefined, { as: 'ANONYMOUS' })).status).toBe(401);
  });
});
