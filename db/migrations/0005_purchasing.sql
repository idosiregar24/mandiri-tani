-- 0005_purchasing — pembelian (PO, penerimaan, faktur, retur beli), hutang & retur jual (Sprint 8).
-- Sumber: .claude/File Skema/Mandiri Tani v1.0/mandiri_tani_schema.sql bagian 5, 6 (payables) & 4 (retur jual).
-- PO & penerimaan terpisah dibuat agar skema sinkron; v1 hanya memakai faktur langsung (sprint-8 S8-1).
-- Forward-only: JANGAN ubah setelah diterapkan.


CREATE TABLE purchase_orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number         text NOT NULL UNIQUE,
  supplier_id    uuid NOT NULL REFERENCES suppliers(id),
  order_date     date NOT NULL,
  expected_date  date,
  status         text NOT NULL DEFAULT 'DRAFT'
                 CHECK (status IN ('DRAFT','SENT','PARTIAL','RECEIVED','CLOSED','CANCELLED')),
  subtotal       numeric(18,2) NOT NULL DEFAULT 0,
  discount_amount numeric(18,2) NOT NULL DEFAULT 0,
  tax_amount     numeric(18,2) NOT NULL DEFAULT 0,
  total          numeric(18,2) NOT NULL DEFAULT 0,
  note           text,
  created_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_orders_supplier_idx ON purchase_orders (supplier_id, order_date);
CREATE INDEX purchase_orders_created_by_idx ON purchase_orders (created_by);

CREATE TABLE purchase_order_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id  uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_no            integer NOT NULL,
  product_id         uuid NOT NULL REFERENCES products(id),
  product_unit_id    uuid NOT NULL REFERENCES product_units(id),
  conversion_qty     numeric(18,4) NOT NULL,
  qty                numeric(18,4) NOT NULL CHECK (qty > 0),
  base_qty           numeric(18,4) NOT NULL CHECK (base_qty > 0),
  unit_price         numeric(18,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount    numeric(18,2) NOT NULL DEFAULT 0,
  line_total         numeric(18,2) NOT NULL,
  received_base_qty  numeric(18,4) NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX purchase_order_items_line_uq ON purchase_order_items (purchase_order_id, line_no);
CREATE INDEX purchase_order_items_product_idx ON purchase_order_items (product_id);
CREATE INDEX purchase_order_items_unit_idx ON purchase_order_items (product_unit_id);

CREATE TABLE goods_receipts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number                text NOT NULL UNIQUE,
  supplier_id           uuid NOT NULL REFERENCES suppliers(id),
  purchase_order_id     uuid REFERENCES purchase_orders(id),
  warehouse_id          uuid NOT NULL REFERENCES warehouses(id),
  received_at           timestamptz NOT NULL DEFAULT now(),
  supplier_delivery_no  text,                     -- no. surat jalan
  status                text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED','INVOICED','CANCELLED')),
  note                  text,
  created_by            uuid NOT NULL REFERENCES users(id),
  posted_by             uuid REFERENCES users(id),
  posted_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX goods_receipts_supplier_idx ON goods_receipts (supplier_id);
CREATE INDEX goods_receipts_po_idx ON goods_receipts (purchase_order_id);
CREATE INDEX goods_receipts_warehouse_idx ON goods_receipts (warehouse_id);
CREATE INDEX goods_receipts_created_by_idx ON goods_receipts (created_by);
CREATE INDEX goods_receipts_posted_by_idx ON goods_receipts (posted_by);

CREATE TABLE goods_receipt_items (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goods_receipt_id        uuid NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  purchase_order_item_id  uuid REFERENCES purchase_order_items(id),
  line_no                 integer NOT NULL,
  product_id              uuid NOT NULL REFERENCES products(id),
  product_unit_id         uuid NOT NULL REFERENCES product_units(id),
  conversion_qty          numeric(18,4) NOT NULL,
  qty                     numeric(18,4) NOT NULL CHECK (qty > 0),
  base_qty                numeric(18,4) NOT NULL CHECK (base_qty > 0),
  unit_price              numeric(18,2) NOT NULL CHECK (unit_price >= 0),  -- per satuan baris
  discount_amount         numeric(18,2) NOT NULL DEFAULT 0,
  line_total              numeric(18,2) NOT NULL,
  landed_cost_alloc       numeric(18,2) NOT NULL DEFAULT 0,   -- alokasi ongkos angkut (FR-PUR-05)
  cost_per_base           numeric(18,4) NOT NULL,             -- (line_total + landed_cost_alloc) / base_qty
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX goods_receipt_items_line_uq ON goods_receipt_items (goods_receipt_id, line_no);
CREATE INDEX goods_receipt_items_po_item_idx ON goods_receipt_items (purchase_order_item_id);
CREATE INDEX goods_receipt_items_product_idx ON goods_receipt_items (product_id);
CREATE INDEX goods_receipt_items_unit_idx ON goods_receipt_items (product_unit_id);

CREATE TABLE purchase_invoices (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number               text NOT NULL UNIQUE,             -- nomor internal FB/...
  supplier_invoice_no  text,
  supplier_id          uuid NOT NULL REFERENCES suppliers(id),
  invoice_date         date NOT NULL,
  due_date             date NOT NULL,
  subtotal             numeric(18,2) NOT NULL DEFAULT 0,
  discount_amount      numeric(18,2) NOT NULL DEFAULT 0,
  other_cost           numeric(18,2) NOT NULL DEFAULT 0, -- ongkos angkut dsb.
  tax_amount           numeric(18,2) NOT NULL DEFAULT 0,
  total                numeric(18,2) NOT NULL DEFAULT 0,
  is_direct            boolean NOT NULL DEFAULT false,   -- faktur langsung (FR-PUR-04)
  status               text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','VOIDED')),
  note                 text,
  client_op_id         uuid UNIQUE,                      -- idempotensi (Idempotency-Key)
  created_by           uuid NOT NULL REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX purchase_invoices_supplier_no_uq ON purchase_invoices (supplier_id, supplier_invoice_no)
  WHERE supplier_invoice_no IS NOT NULL AND status <> 'VOIDED';
CREATE INDEX purchase_invoices_date_idx ON purchase_invoices (invoice_date);
CREATE INDEX purchase_invoices_created_by_idx ON purchase_invoices (created_by);

CREATE TABLE purchase_invoice_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_invoice_id    uuid NOT NULL REFERENCES purchase_invoices(id),
  goods_receipt_item_id  uuid NOT NULL UNIQUE REFERENCES goods_receipt_items(id),  -- satu baris terima ditagih sekali
  line_total             numeric(18,2) NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_invoice_items_invoice_idx ON purchase_invoice_items (purchase_invoice_id);

CREATE TABLE purchase_returns (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number               text NOT NULL UNIQUE,
  supplier_id          uuid NOT NULL REFERENCES suppliers(id),
  purchase_invoice_id  uuid REFERENCES purchase_invoices(id),
  warehouse_id         uuid NOT NULL REFERENCES warehouses(id),
  trx_at               timestamptz NOT NULL DEFAULT now(),
  settlement           text NOT NULL CHECK (settlement IN ('REDUCE_PAYABLE','CASH_REFUND')),
  total                numeric(18,2) NOT NULL CHECK (total >= 0),   -- nilai harga beli
  reason               text NOT NULL,
  client_op_id         uuid UNIQUE,                      -- idempotensi (Idempotency-Key)
  created_by           uuid NOT NULL REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_returns_supplier_idx ON purchase_returns (supplier_id);
CREATE INDEX purchase_returns_invoice_idx ON purchase_returns (purchase_invoice_id);
CREATE INDEX purchase_returns_warehouse_idx ON purchase_returns (warehouse_id);
CREATE INDEX purchase_returns_created_by_idx ON purchase_returns (created_by);

CREATE TABLE purchase_return_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_return_id  uuid NOT NULL REFERENCES purchase_returns(id),
  product_id          uuid NOT NULL REFERENCES products(id),
  product_unit_id     uuid NOT NULL REFERENCES product_units(id),
  conversion_qty      numeric(18,4) NOT NULL,
  qty                 numeric(18,4) NOT NULL CHECK (qty > 0),
  base_qty            numeric(18,4) NOT NULL CHECK (base_qty > 0),
  unit_price          numeric(18,2) NOT NULL,       -- harga beli (untuk potong hutang)
  line_total          numeric(18,2) NOT NULL,
  unit_cost           numeric(18,4) NOT NULL,       -- HPP FIFO saat keluar (lapisan penerimaan asal dulu — PRD §6.6)
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_return_items_return_idx ON purchase_return_items (purchase_return_id);
CREATE INDEX purchase_return_items_product_idx ON purchase_return_items (product_id);
CREATE INDEX purchase_return_items_unit_idx ON purchase_return_items (product_unit_id);

CREATE TABLE payables (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id   uuid NOT NULL REFERENCES suppliers(id),
  source_type   text NOT NULL CHECK (source_type IN ('PURCHASE_INVOICE','OPENING')),
  source_id     uuid,
  doc_number    text NOT NULL,
  doc_date      date NOT NULL,
  due_date      date NOT NULL,
  amount        numeric(18,2) NOT NULL CHECK (amount > 0),
  paid_amount   numeric(18,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  status        text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PARTIAL','PAID','VOIDED')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (paid_amount <= amount),
  CHECK (source_type = 'OPENING' OR source_id IS NOT NULL)
);
CREATE UNIQUE INDEX payables_source_uq ON payables (source_type, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX payables_supplier_open_idx ON payables (supplier_id) WHERE status IN ('OPEN','PARTIAL');
CREATE INDEX payables_due_open_idx ON payables (due_date) WHERE status IN ('OPEN','PARTIAL');
CREATE INDEX payables_supplier_idx ON payables (supplier_id);

CREATE TABLE sale_returns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number          text NOT NULL UNIQUE,
  sale_id         uuid NOT NULL REFERENCES sales(id),
  customer_id     uuid NOT NULL REFERENCES customers(id),
  device_id       uuid NOT NULL REFERENCES devices(id),
  shift_id        uuid REFERENCES shifts(id),               -- bila refund tunai dari laci
  warehouse_id    uuid NOT NULL REFERENCES warehouses(id),
  trx_at          timestamptz NOT NULL DEFAULT now(),
  settlement      text NOT NULL CHECK (settlement IN ('CASH_REFUND','REDUCE_RECEIVABLE')),
  total           numeric(18,2) NOT NULL CHECK (total >= 0),
  reason          text NOT NULL,
  created_by      uuid NOT NULL REFERENCES users(id),
  approved_by     uuid REFERENCES users(id),
  client_op_id    uuid UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sale_returns_sale_idx ON sale_returns (sale_id);
CREATE INDEX sale_returns_customer_idx ON sale_returns (customer_id);
CREATE INDEX sale_returns_device_idx ON sale_returns (device_id);
CREATE INDEX sale_returns_shift_idx ON sale_returns (shift_id);
CREATE INDEX sale_returns_warehouse_idx ON sale_returns (warehouse_id);
CREATE INDEX sale_returns_trx_at_idx ON sale_returns (trx_at);
CREATE INDEX sale_returns_created_by_idx ON sale_returns (created_by);
CREATE INDEX sale_returns_approved_by_idx ON sale_returns (approved_by);

CREATE TABLE sale_return_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id      uuid NOT NULL REFERENCES sale_returns(id),
  sale_item_id   uuid NOT NULL REFERENCES sale_items(id),
  qty            numeric(18,4) NOT NULL CHECK (qty > 0),     -- satuan baris nota asal
  base_qty       numeric(18,4) NOT NULL CHECK (base_qty > 0),
  amount         numeric(18,2) NOT NULL,                     -- porsi net_amount nota asal
  cost_per_base  numeric(18,4) NOT NULL,                     -- dari nota asal
  restock        boolean NOT NULL DEFAULT true,              -- false = barang rusak, tidak kembali ke stok
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sale_return_items_return_idx ON sale_return_items (return_id);
CREATE INDEX sale_return_items_sale_item_idx ON sale_return_items (sale_item_id);

SELECT ensure_updated_at_triggers();
