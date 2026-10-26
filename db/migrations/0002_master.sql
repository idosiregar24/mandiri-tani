-- 0002_master — master data (sumber: .claude/File Skema/Mandiri Tani v1.0/mandiri_tani_schema.sql bagian 2)
-- + data awal yang dibutuhkan setiap instalasi (database-standards §8). Sprint 3.
-- Forward-only: JANGAN ubah file ini setelah diterapkan; buat migrasi baru (database-standards §2).

-- =============================================================================
-- 2. MASTER DATA (semua disinkron → deleted_at + index updated_at)
-- =============================================================================
CREATE TABLE units (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,                        -- PCS, BTL, DUS, PAK, ZAK, KG, LTR, ...
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE UNIQUE INDEX units_code_uq ON units (upper(code)) WHERE deleted_at IS NULL;
CREATE INDEX units_updated_idx ON units (updated_at);

CREATE TABLE categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id   uuid REFERENCES categories(id),
  name        text NOT NULL,
  attribute_schema jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{key,label,type}] untuk products.attributes (FR-MD-05)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX categories_parent_idx ON categories (parent_id);
CREATE INDEX categories_updated_idx ON categories (updated_at);

CREATE TABLE brands (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX brands_updated_idx ON brands (updated_at);

CREATE TABLE warehouses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,
  name        text NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE UNIQUE INDEX warehouses_code_uq ON warehouses (upper(code)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX warehouses_one_default_uq ON warehouses ((true)) WHERE is_default AND deleted_at IS NULL;
CREATE INDEX warehouses_updated_idx ON warehouses (updated_at);

CREATE TABLE customer_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,                        -- UMUM + dari iPOS: BRONZE, SILVER, GOLD, RAM_1, RAM_2
  name        text NOT NULL,
  discount_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),  -- saran diskon nota (iPOS supelgrup.potongan)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE UNIQUE INDEX customer_groups_code_uq ON customer_groups (upper(code)) WHERE deleted_at IS NULL;
CREATE INDEX customer_groups_updated_idx ON customer_groups (updated_at);

CREATE TABLE customers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL,
  name               text NOT NULL,
  phone              text,                          -- digit saja, 08…
  address            text,
  village            text,                          -- desa
  customer_group_id  uuid REFERENCES customer_groups(id),
  credit_limit       numeric(18,2) CHECK (credit_limit >= 0),   -- NULL = tanpa batas (D-7); 0 = tidak boleh kredit
  payment_term_days  integer NOT NULL DEFAULT 10 CHECK (payment_term_days >= 0),  -- iPOS DEF_JATUH_TEMPO = 10
  is_walk_in         boolean NOT NULL DEFAULT false,  -- pelanggan UMUM bawaan
  notes              text,
  attributes         jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE UNIQUE INDEX customers_code_uq ON customers (upper(code)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX customers_one_walk_in_uq ON customers ((true)) WHERE is_walk_in;
CREATE INDEX customers_group_idx ON customers (customer_group_id);
CREATE INDEX customers_name_trgm ON customers USING gin (name gin_trgm_ops);
CREATE INDEX customers_updated_idx ON customers (updated_at);

CREATE TABLE suppliers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL,
  name               text NOT NULL,
  contact_name       text,
  phone              text,
  address            text,
  payment_term_days  integer NOT NULL DEFAULT 0 CHECK (payment_term_days >= 0),
  notes              text,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE UNIQUE INDEX suppliers_code_uq ON suppliers (upper(code)) WHERE deleted_at IS NULL;
CREATE INDEX suppliers_updated_idx ON suppliers (updated_at);

CREATE TABLE cash_accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,                        -- LACI, KAS_TOKO, BANK_BCA, ...
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('DRAWER','CASH','BANK')),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE UNIQUE INDEX cash_accounts_code_uq ON cash_accounts (upper(code)) WHERE deleted_at IS NULL;

CREATE TABLE payment_methods (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL,                   -- CASH, QRIS, TRANSFER_BCA, CREDIT
  name             text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('CASH','QRIS','TRANSFER','CREDIT')),
  cash_account_id  uuid REFERENCES cash_accounts(id),  -- tujuan dana (NULL untuk CREDIT; CASH → laci shift)
  config           jsonb NOT NULL DEFAULT '{}'::jsonb, -- rekening tujuan, path gambar QRIS statis
  sort_order       integer NOT NULL DEFAULT 0,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CHECK (kind = 'CREDIT' OR kind = 'CASH' OR cash_account_id IS NOT NULL)
);
CREATE UNIQUE INDEX payment_methods_code_uq ON payment_methods (upper(code)) WHERE deleted_at IS NULL;
CREATE INDEX payment_methods_cash_account_idx ON payment_methods (cash_account_id);
CREATE INDEX payment_methods_updated_idx ON payment_methods (updated_at);

CREATE TABLE cash_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,   -- SALES, PURCHASE, AR_PAYMENT, AP_PAYMENT, SALE_REFUND, OPEX_*, CAPITAL, DRAWING, TRANSFER
  name        text NOT NULL,
  direction   text NOT NULL CHECK (direction IN ('IN','OUT','BOTH')),
  is_system   boolean NOT NULL DEFAULT false,       -- kategori sistem tidak bisa diubah/dihapus
  is_operating_expense boolean NOT NULL DEFAULT false, -- dipakai FR-FIN-06
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE UNIQUE INDEX cash_categories_code_uq ON cash_categories (upper(code)) WHERE deleted_at IS NULL;

CREATE TABLE products (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku                 text NOT NULL,
  name                text NOT NULL,
  category_id         uuid REFERENCES categories(id),
  brand_id            uuid REFERENCES brands(id),
  item_type           text NOT NULL DEFAULT 'STANDARD'
                      CHECK (item_type IN ('STANDARD','BUNDLE','ASSEMBLY','SERVICE')),
  base_unit_id        uuid NOT NULL REFERENCES units(id),
  track_stock         boolean NOT NULL DEFAULT true,
  allow_decimal_qty   boolean NOT NULL DEFAULT false,
  min_stock           numeric(18,4) NOT NULL DEFAULT 0,   -- satuan dasar
  max_stock           numeric(18,4),
  -- HPP = FIFO (ADR-04): nilai ada di stock_cost_layers, bukan kolom di sini.
  last_purchase_cost  numeric(18,4),                      -- harga beli terakhir per satuan dasar
  attributes          jsonb NOT NULL DEFAULT '{}'::jsonb, -- atribut dinamis (FR-MD-05)
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CHECK (item_type NOT IN ('BUNDLE','SERVICE') OR track_stock = false)
);
CREATE UNIQUE INDEX products_sku_uq ON products (upper(sku)) WHERE deleted_at IS NULL;
CREATE INDEX products_name_trgm ON products USING gin (name gin_trgm_ops);
CREATE INDEX products_sku_trgm ON products USING gin (sku gin_trgm_ops);
CREATE INDEX products_attributes_gin ON products USING gin (attributes jsonb_path_ops);
CREATE INDEX products_category_idx ON products (category_id);
CREATE INDEX products_brand_idx ON products (brand_id);
CREATE INDEX products_base_unit_idx ON products (base_unit_id);
CREATE INDEX products_updated_idx ON products (updated_at);

CREATE TABLE product_units (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id           uuid NOT NULL REFERENCES products(id),
  unit_id              uuid NOT NULL REFERENCES units(id),
  conversion_qty       numeric(18,4) NOT NULL CHECK (conversion_qty > 0),  -- jumlah satuan dasar dalam 1 satuan ini
  is_base              boolean NOT NULL DEFAULT false,
  is_default_sale      boolean NOT NULL DEFAULT false,
  is_default_purchase  boolean NOT NULL DEFAULT false,
  is_sellable          boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  CHECK (NOT is_base OR conversion_qty = 1)
);
CREATE UNIQUE INDEX product_units_uq ON product_units (product_id, unit_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX product_units_one_base_uq ON product_units (product_id) WHERE is_base AND deleted_at IS NULL;
CREATE INDEX product_units_unit_idx ON product_units (unit_id);
CREATE INDEX product_units_updated_idx ON product_units (updated_at);

CREATE TABLE product_barcodes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_unit_id  uuid NOT NULL REFERENCES product_units(id),
  barcode          text NOT NULL,
  is_internal      boolean NOT NULL DEFAULT false,    -- dibuat generator internal (prefix 2)
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE UNIQUE INDEX product_barcodes_barcode_uq ON product_barcodes (barcode) WHERE deleted_at IS NULL;
CREATE INDEX product_barcodes_unit_idx ON product_barcodes (product_unit_id);
CREATE INDEX product_barcodes_updated_idx ON product_barcodes (updated_at);

-- Harga per satuan × grup pelanggan (NULL = umum) × tier min_qty — PRD §6.3
CREATE TABLE product_prices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_unit_id    uuid NOT NULL REFERENCES product_units(id),
  customer_group_id  uuid REFERENCES customer_groups(id),
  min_qty            numeric(18,4) NOT NULL DEFAULT 1 CHECK (min_qty > 0),  -- dalam satuan baris
  price              numeric(18,2) NOT NULL CHECK (price >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE UNIQUE INDEX product_prices_uq ON product_prices (product_unit_id, customer_group_id, min_qty)
  NULLS NOT DISTINCT WHERE deleted_at IS NULL;
CREATE INDEX product_prices_group_idx ON product_prices (customer_group_id);
CREATE INDEX product_prices_updated_idx ON product_prices (updated_at);

-- BOM: komponen BUNDLE / ASSEMBLY (qty dalam satuan dasar komponen)
CREATE TABLE product_components (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id            uuid NOT NULL REFERENCES products(id),
  component_product_id  uuid NOT NULL REFERENCES products(id),
  qty                   numeric(18,4) NOT NULL CHECK (qty > 0),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  CHECK (product_id <> component_product_id)
);
CREATE UNIQUE INDEX product_components_uq ON product_components (product_id, component_product_id) WHERE deleted_at IS NULL;
CREATE INDEX product_components_component_idx ON product_components (component_product_id);
CREATE INDEX product_components_updated_idx ON product_components (updated_at);

SELECT ensure_updated_at_triggers();

-- Impor sebelum ada akun (Sprint 3 dikerjakan sebelum Sprint 2, keputusan S3-2):
-- NULL = dijalankan lewat kunci akses lokal desktop. Mulai Sprint 2 service selalu mengisinya.
ALTER TABLE import_batches ALTER COLUMN created_by DROP NOT NULL;

-- =============================================================================
-- Data awal setiap instalasi. Satu fungsi idempoten: dipanggil di sini dan lagi
-- oleh "Reset data persiapan" (FR-MIG-08) setelah data master dihapus.
-- Data toko lain (grup Bronze/Silver/Gold/RAM, kategori, item, pelanggan, supplier,
-- rekening bank) datang dari importer iPOS atau diinput Owner.
-- =============================================================================
CREATE OR REPLACE FUNCTION seed_master_defaults() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- Satuan = daftar tbl_itemsatuan iPOS (kode dipertahankan agar akrab bagi toko: ZAK, bukan SAK)
  INSERT INTO units (id, code, name)
  SELECT uuidv7(), v.code, v.name
  FROM (VALUES ('PCS','Pcs'), ('BTL','Botol'), ('LTR','Liter'), ('GLN','Galon'), ('PAIL','Pail'),
               ('KG','Kilogram'), ('ZAK','Zak'), ('GRAM','Gram'), ('BOX','Box'), ('DUS','Dus'), ('PAK','Pak'))
       AS v(code, name)
  WHERE NOT EXISTS (SELECT 1 FROM units u WHERE upper(u.code) = v.code AND u.deleted_at IS NULL);

  INSERT INTO customer_groups (id, code, name)
  SELECT uuidv7(), 'UMUM', 'Umum'
  WHERE NOT EXISTS (SELECT 1 FROM customer_groups WHERE upper(code) = 'UMUM' AND deleted_at IS NULL);

  -- Pelanggan UMUM (walk-in) bawaan — FR-MD-08; nota KSR tanpa nama memakai pelanggan ini.
  INSERT INTO customers (id, code, name, customer_group_id, is_walk_in, credit_limit)
  SELECT uuidv7(), 'UMUM', 'Umum',
         (SELECT id FROM customer_groups WHERE upper(code) = 'UMUM' AND deleted_at IS NULL), true, 0
  WHERE NOT EXISTS (SELECT 1 FROM customers WHERE is_walk_in);

  -- Satu toko, satu gudang (Analisis §2): kode UTM sama dengan iPOS agar nomor dokumen identik.
  INSERT INTO warehouses (id, code, name, is_default)
  SELECT uuidv7(), 'UTM', 'Gudang Utama', true
  WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE deleted_at IS NULL);

  INSERT INTO cash_accounts (id, code, name, kind)
  SELECT uuidv7(), v.code, v.name, v.kind
  FROM (VALUES ('LACI', 'Laci Kasir', 'DRAWER'), ('KAS_TOKO', 'Kas Toko', 'CASH')) AS v(code, name, kind)
  WHERE NOT EXISTS (SELECT 1 FROM cash_accounts c WHERE upper(c.code) = v.code AND c.deleted_at IS NULL);

  -- Kategori OPEX = pola 498 kas keluar iPOS (Analisis §2).
  INSERT INTO cash_categories (id, code, name, direction, is_system, is_operating_expense)
  SELECT uuidv7(), v.code, v.name, v.direction, v.is_system, v.opex
  FROM (VALUES
    ('SALES',           'Penjualan',                 'IN',   true,  false),
    ('SALE_REFUND',     'Pengembalian Penjualan',    'OUT',  true,  false),
    ('AR_PAYMENT',      'Pelunasan Piutang',         'IN',   true,  false),
    ('PURCHASE',        'Pembelian Tunai',           'OUT',  true,  false),
    ('AP_PAYMENT',      'Pembayaran Hutang',         'OUT',  true,  false),
    ('PURCHASE_REFUND', 'Pengembalian Pembelian',    'IN',   true,  false),
    ('OPENING_CASH',    'Modal Awal Shift',          'IN',   true,  false),
    ('TRANSFER',        'Setoran / Transfer Kas',    'BOTH', true,  false),
    ('CAPITAL',         'Modal Owner',               'IN',   true,  false),
    ('DRAWING',         'Prive Owner',               'OUT',  true,  false),
    ('OPEX_EXPEDITION', 'Biaya Ekspedisi',           'OUT',  false, true),
    ('OPEX_UNLOADING',  'Upah Bongkar Muat',         'OUT',  false, true),
    ('OPEX_VEHICLE',    'BBM & Perbaikan Kendaraan', 'OUT',  false, true),
    ('OPEX_WAGES',      'Upah / Gaji',               'OUT',  false, true),
    ('OPEX_GENERAL',    'Biaya Operasional Lain',    'OUT',  false, true)
  ) AS v(code, name, direction, is_system, opex)
  WHERE NOT EXISTS (SELECT 1 FROM cash_categories c WHERE upper(c.code) = v.code AND c.deleted_at IS NULL);

  -- QRIS & TRANSFER dibuat Owner (atau importer: rekening iPOS) karena butuh rekening BANK tujuan.
  INSERT INTO payment_methods (id, code, name, kind, sort_order)
  SELECT uuidv7(), v.code, v.name, v.kind, v.sort_order
  FROM (VALUES ('CASH', 'Tunai', 'CASH', 1), ('CREDIT', 'Piutang', 'CREDIT', 9)) AS v(code, name, kind, sort_order)
  WHERE NOT EXISTS (SELECT 1 FROM payment_methods p WHERE upper(p.code) = v.code AND p.deleted_at IS NULL);
END $$;

SELECT seed_master_defaults();
