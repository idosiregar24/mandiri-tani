import { Router } from 'express';
import { BrandInput, CategoryInput, CustomerGroupInput, UnitInput, WarehouseInput } from '@shared/schemas/master';
import type { Pool } from '../../db/pool';
import { parseId } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import * as service from './service';

/** /units, /categories, /brands, /warehouses, /customer-groups — read: products.read, write: masters.write. */
export function masterRoutes({ pool }: { pool: Pool }): Router {
  const router = Router();
  const read = requirePermission('products.read');
  const write = requirePermission('masters.write');

  router.get('/units', read, async (_req, res) => {
    res.json({ data: await service.listUnits(pool) });
  });
  router.post('/units', write, async (req, res) => {
    res.status(201).json({ data: await service.createUnit(pool, UnitInput.parse(req.body)) });
  });
  router.put('/units/:id', write, async (req, res) => {
    res.json({ data: await service.updateUnit(pool, parseId(req.params.id, 'Satuan'), UnitInput.parse(req.body)) });
  });
  router.delete('/units/:id', write, async (req, res) => {
    await service.deleteUnit(pool, req.ctx, parseId(req.params.id, 'Satuan'));
    res.status(204).end();
  });

  router.get('/categories', read, async (_req, res) => {
    res.json({ data: await service.listCategories(pool) });
  });
  router.post('/categories', write, async (req, res) => {
    res.status(201).json({ data: await service.createCategory(pool, CategoryInput.parse(req.body)) });
  });
  router.put('/categories/:id', write, async (req, res) => {
    res.json({
      data: await service.updateCategory(pool, parseId(req.params.id, 'Kategori'), CategoryInput.parse(req.body)),
    });
  });
  router.delete('/categories/:id', write, async (req, res) => {
    await service.deleteCategory(pool, req.ctx, parseId(req.params.id, 'Kategori'));
    res.status(204).end();
  });

  router.get('/brands', read, async (_req, res) => {
    res.json({ data: await service.listBrands(pool) });
  });
  router.post('/brands', write, async (req, res) => {
    res.status(201).json({ data: await service.createBrand(pool, BrandInput.parse(req.body)) });
  });
  router.put('/brands/:id', write, async (req, res) => {
    res.json({ data: await service.updateBrand(pool, parseId(req.params.id, 'Merek'), BrandInput.parse(req.body)) });
  });
  router.delete('/brands/:id', write, async (req, res) => {
    await service.deleteBrand(pool, req.ctx, parseId(req.params.id, 'Merek'));
    res.status(204).end();
  });

  router.get('/warehouses', read, async (_req, res) => {
    res.json({ data: await service.listWarehouses(pool) });
  });
  router.post('/warehouses', write, async (req, res) => {
    res.status(201).json({ data: await service.createWarehouse(pool, WarehouseInput.parse(req.body)) });
  });
  router.put('/warehouses/:id', write, async (req, res) => {
    res.json({
      data: await service.updateWarehouse(pool, parseId(req.params.id, 'Gudang'), WarehouseInput.parse(req.body)),
    });
  });
  router.delete('/warehouses/:id', write, async (req, res) => {
    await service.deleteWarehouse(pool, req.ctx, parseId(req.params.id, 'Gudang'));
    res.status(204).end();
  });

  router.get('/customer-groups', requirePermission('customers.read'), async (_req, res) => {
    res.json({ data: await service.listCustomerGroups(pool) });
  });
  router.post('/customer-groups', requirePermission('customers.write'), async (req, res) => {
    res.status(201).json({ data: await service.createCustomerGroup(pool, CustomerGroupInput.parse(req.body)) });
  });
  router.put('/customer-groups/:id', requirePermission('customers.write'), async (req, res) => {
    const id = parseId(req.params.id, 'Grup pelanggan');
    res.json({ data: await service.updateCustomerGroup(pool, id, CustomerGroupInput.parse(req.body)) });
  });
  router.delete('/customer-groups/:id', requirePermission('customers.write'), async (req, res) => {
    await service.deleteCustomerGroup(pool, req.ctx, parseId(req.params.id, 'Grup pelanggan'));
    res.status(204).end();
  });

  return router;
}
