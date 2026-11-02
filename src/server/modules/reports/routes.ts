import { Router } from 'express';
import type { Pool } from '../../db/pool';
import { requirePermission } from '../../middleware/auth';
import { sendReport } from './common';
import { cashflow, cashflowXlsx } from './cashflow';
import { dashboard } from './dashboard';
import { dailyFertilizer, dailyFertilizerXlsx } from './fertilizer';
import { pickupsReport, pickupsXlsx, undelivered, undeliveredXlsx } from './pickups';
import {
  profitByInvoice,
  profitByInvoiceXlsx,
  profitByItem,
  profitByItemXlsx,
  profitLoss,
  profitLossXlsx,
} from './profit';
import { purchasesReport, purchasesXlsx } from './purchases';
import { salesReport, salesXlsx } from './sales';
import { stockReport, stockXlsx } from './stock';

/**
 * Reports (sprint-10 S10-6): sales & dashboard for both roles (a cashier gets only their own sales,
 * no profit); profit needs reports.profit, cash flow reports.cashflow, everything else reports.all.
 * Every report also comes as Excel with ?format=xlsx.
 */
export function reportRoutes({ pool }: { pool: Pool }): Router {
  const router = Router();
  const sales = requirePermission('reports.sales');
  const profit = requirePermission('reports.profit');
  const all = requirePermission('reports.all');

  router.get('/reports/dashboard', sales, async (req, res) => {
    res.json({ data: await dashboard(pool, req.ctx) });
  });
  router.get('/reports/sales', sales, async (req, res) => {
    await sendReport(req, res, await salesReport(pool, req.ctx, req.query), salesXlsx, 'penjualan');
  });
  router.get('/reports/profit-by-item', profit, async (req, res) => {
    await sendReport(req, res, await profitByItem(pool, req.query), profitByItemXlsx, 'laba-per-barang');
  });
  router.get('/reports/profit-by-invoice', profit, async (req, res) => {
    await sendReport(req, res, await profitByInvoice(pool, req.query), profitByInvoiceXlsx, 'laba-per-nota');
  });
  router.get('/reports/profit-loss', profit, async (req, res) => {
    await sendReport(req, res, await profitLoss(pool, req.query), profitLossXlsx, 'laba-rugi');
  });
  router.get('/reports/cashflow', requirePermission('reports.cashflow'), async (req, res) => {
    await sendReport(req, res, await cashflow(pool, req.query), cashflowXlsx, 'arus-kas');
  });
  router.get('/reports/purchases', all, async (req, res) => {
    await sendReport(req, res, await purchasesReport(pool, req.query), purchasesXlsx, 'pembelian-detail');
  });
  router.get('/reports/daily-fertilizer', all, async (req, res) => {
    await sendReport(req, res, await dailyFertilizer(pool, req.query), dailyFertilizerXlsx, 'rekap-harian-pupuk');
  });
  router.get('/reports/undelivered', all, async (req, res) => {
    await sendReport(req, res, await undelivered(pool, req.query), undeliveredXlsx, 'barang-belum-diambil');
  });
  router.get('/reports/pickups', all, async (req, res) => {
    await sendReport(req, res, await pickupsReport(pool, req.query), pickupsXlsx, 'riwayat-pengambilan');
  });
  router.get('/reports/stock', all, async (req, res) => {
    await sendReport(req, res, await stockReport(pool, req.query), stockXlsx, 'persediaan');
  });
  return router;
}
