import ExcelJS from 'exceljs';
import type { Pool } from '../../db/pool';

export async function exportMasterDataXlsx(pool: Pool): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mandiri Tani POS';
  wb.created = new Date();

  // Sheet 1: Barang / Item
  const wsItems = wb.addWorksheet('Item');
  wsItems.columns = [
    { header: 'Kode Item', key: 'sku', width: 16 },
    { header: 'Barcode', key: 'barcode', width: 16 },
    { header: 'Nama Item', key: 'name', width: 36 },
    { header: 'Satuan', key: 'unit', width: 12 },
    { header: 'Kategori', key: 'category', width: 18 },
    { header: 'Merek', key: 'brand', width: 18 },
    { header: 'Harga Retail', key: 'price', width: 16, style: { numFmt: '#,##0.00' } },
    { header: 'Status', key: 'status', width: 12 },
  ];

  const itemsRes = await pool.query<{
    sku: string;
    barcode: string | null;
    name: string;
    unit: string;
    category: string | null;
    brand: string | null;
    price: number | null;
    isActive: boolean;
  }>(
    `SELECT p.sku, b.barcode, p.name, u.code AS unit, c.name AS category, br.name AS brand,
            pr.price::float AS price, p.is_active AS "isActive"
     FROM products p
     JOIN units u ON u.id = p.base_unit_id
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN brands br ON br.id = p.brand_id
     LEFT JOIN LATERAL (
       SELECT pb.barcode FROM product_units pu
       JOIN product_barcodes pb ON pb.product_unit_id = pu.id
       WHERE pu.product_id = p.id AND pu.is_base = true
       LIMIT 1
     ) b ON true
     LEFT JOIN LATERAL (
       SELECT pp.price FROM product_units pu
       JOIN product_prices pp ON pp.product_unit_id = pu.id
       WHERE pu.product_id = p.id AND pp.customer_group_id IS NULL AND pp.min_qty = 1
       LIMIT 1
     ) pr ON true
     WHERE p.deleted_at IS NULL
     ORDER BY p.name ASC`,
  );

  for (const r of itemsRes.rows) {
    wsItems.addRow({
      sku: r.sku,
      barcode: r.barcode ?? '',
      name: r.name,
      unit: r.unit,
      category: r.category ?? '',
      brand: r.brand ?? '',
      price: r.price ?? 0,
      status: r.isActive ? 'AKTIF' : 'NONAKTIF',
    });
  }

  // Sheet 2: Pelanggan
  const wsCust = wb.addWorksheet('Pelanggan');
  wsCust.columns = [
    { header: 'Kode Pelanggan', key: 'code', width: 16 },
    { header: 'Nama Pelanggan', key: 'name', width: 32 },
    { header: 'Grup', key: 'group', width: 18 },
    { header: 'Alamat', key: 'address', width: 32 },
    { header: 'Telepon', key: 'phone', width: 18 },
    { header: 'Plafon Kredit', key: 'creditLimit', width: 18, style: { numFmt: '#,##0.00' } },
    { header: 'Status', key: 'status', width: 12 },
  ];

  const custRes = await pool.query<{
    code: string;
    name: string;
    group: string | null;
    address: string | null;
    phone: string | null;
    creditLimit: number | null;
    isActive: boolean;
  }>(
    `SELECT c.code, c.name, g.name AS group, c.address, c.phone,
            c.credit_limit::float AS "creditLimit", c.is_active AS "isActive"
     FROM customers c
     LEFT JOIN customer_groups g ON g.id = c.customer_group_id
     WHERE c.deleted_at IS NULL
     ORDER BY c.name ASC`,
  );

  for (const r of custRes.rows) {
    wsCust.addRow({
      code: r.code,
      name: r.name,
      group: r.group ?? '',
      address: r.address ?? '',
      phone: r.phone ?? '',
      creditLimit: r.creditLimit ?? 0,
      status: r.isActive ? 'AKTIF' : 'NONAKTIF',
    });
  }

  // Sheet 3: Supplier
  const wsSupp = wb.addWorksheet('Supplier');
  wsSupp.columns = [
    { header: 'Kode Supplier', key: 'code', width: 16 },
    { header: 'Nama Supplier', key: 'name', width: 32 },
    { header: 'Alamat', key: 'address', width: 32 },
    { header: 'Telepon', key: 'phone', width: 18 },
    { header: 'Kontak Person', key: 'contactPerson', width: 24 },
    { header: 'Status', key: 'status', width: 12 },
  ];

  const suppRes = await pool.query<{
    code: string;
    name: string;
    address: string | null;
    phone: string | null;
    contactName: string | null;
    isActive: boolean;
  }>(
    `SELECT s.code, s.name, s.address, s.phone, s.contact_name AS "contactName", s.is_active AS "isActive"
     FROM suppliers s
     WHERE s.deleted_at IS NULL
     ORDER BY s.name ASC`,
  );

  for (const r of suppRes.rows) {
    wsSupp.addRow({
      code: r.code,
      name: r.name,
      address: r.address ?? '',
      phone: r.phone ?? '',
      contactPerson: r.contactName ?? '',
      status: r.isActive ? 'AKTIF' : 'NONAKTIF',
    });
  }

  // Style header rows
  for (const ws of [wsItems, wsCust, wsSupp]) {
    const headRow = ws.getRow(1);
    headRow.font = { bold: true };
    headRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE8F5E9' },
    };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
