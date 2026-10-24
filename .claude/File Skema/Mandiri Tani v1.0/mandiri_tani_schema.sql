-- =============================================================================
-- Mandiri Tani POS v1.0 — Skema PostgreSQL (otoritatif)
-- Target: PostgreSQL >= 15 (memakai UNIQUE NULLS NOT DISTINCT). Major dipin per rilis.
-- Dokumen desain: PRD-Mandiri-Tani-POS.md §6. Bila prosa PRD dan file ini
-- berbeda, FILE INI yang benar — perbarui PRD, bukan sebaliknya.
-- Disesuaikan dengan data nyata toko (iPOS 5 + Excel): Analisis-Sumber-Data-iPOS.md
-- (keputusan D-1..D-11 dirujuk di komentar kolom). Fitur "terjual belum
-- diambil": .claude/plan/feature-pengambilan-barang.md.
--
-- Konvensi (lihat .claude/rules/database-standards.md):
--   * PK uuid = UUIDv7 dari aplikasi; DEFAULT gen_random_uuid() hanya pengaman.
--   * Uang NUMERIC(18,2), HPP NUMERIC(18,4), qty & konversi NUMERIC(18,4).
--   * Status = text + CHECK (bukan ENUM).
--   * updated_at diisi trigger set_updated_at() (clock_timestamp) — dasar ?since=.
--   * Master yang disinkron punya deleted_at (tombstone), tidak pernah hard delete.
--   * Ledger append-only: stock_movements, cash_transactions, audit_logs.
--   * Semua FK ber-index (PostgreSQL tidak membuatnya otomatis).
--
-- Status: BELUM dieksekusi terhadap server PostgreSQL. Sprint 1 memecahnya
-- menjadi db/migrations/0001_*.sql dst. dan menjalankannya di test integrasi.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- trusted extension (PG13+), boleh dibuat owner DB

-- -----------------------------------------------------------------------------
-- Fungsi umum
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tabel % bersifat append-only (% ditolak)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'P0001';
END $$;

-- =============================================================================
-- 1. SISTEM
-- =============================================================================
CREATE TABLE settings (
  key         text PRIMARY KEY,   -- 'store','receipt','printer','pos','tax','rounding','stock','backup'
  value       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username         text NOT NULL,
  full_name        text NOT NULL,
  role             text NOT NULL CHECK (role IN ('OWNER','SUPERVISOR','KASIR')),
  password_hash    text,                      -- argon2id; NULL = hanya login PIN
  pin_hash         text,                      -- argon2id dari PIN 6 digit
  failed_attempts  integer NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  is_active        boolean NOT NULL DEFAULT true,   -- user tidak pernah dihapus
  last_login_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (password_hash IS NOT NULL OR pin_hash IS NOT NULL)
);
CREATE UNIQUE INDEX users_username_uq ON users (lower(username));

CREATE TABLE devices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                varchar(3) NOT NULL UNIQUE,   -- K01 = hub; H01.. = HP; T01.. = terminal
  name                text NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('HUB','TERMINAL','MOBILE')),
  token_hash          text UNIQUE,                  -- SHA-256 token perangkat (NULL untuk HUB)
  app_version         text,
  paired_at           timestamptz,
  last_seen_at        timestamptz,
  last_clock_skew_ms  integer,
  revoked_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE device_pairing_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash   text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('TERMINAL','MOBILE')),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  used_by_device_id uuid REFERENCES devices(id),
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_pairing_codes_created_by_idx ON device_pairing_codes (created_by);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id),
  device_id    uuid NOT NULL REFERENCES devices(id),
  token_hash   text NOT NULL UNIQUE,                -- SHA-256 dari token acak 32 byte
  login_method text NOT NULL CHECK (login_method IN ('PASSWORD','PIN')),
  ip           inet,
  expires_at   timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_device_idx ON sessions (device_id);

-- Token otorisasi supervisor (sekali pakai, satu aksi) — FR-POS-20
CREATE TABLE authorization_grants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    text NOT NULL UNIQUE,
  permission    text NOT NULL,                      -- mis. 'sales.void'
  granted_by    uuid NOT NULL REFERENCES users(id),
  requested_by  uuid NOT NULL REFERENCES users(id),
  device_id     uuid NOT NULL REFERENCES devices(id),
  expires_at    timestamptz NOT NULL,               -- pendek, mis. 2 menit
  used_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX authorization_grants_granted_by_idx ON authorization_grants (granted_by);
CREATE INDEX authorization_grants_requested_by_idx ON authorization_grants (requested_by);
CREATE INDEX authorization_grants_device_idx ON authorization_grants (device_id);

CREATE TABLE audit_logs (
  seq          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_id     uuid REFERENCES users(id),
  approved_by  uuid REFERENCES users(id),          -- pemberi otorisasi supervisor
  device_id    uuid REFERENCES devices(id),
  action       text NOT NULL,                       -- 'sale.void','price.update','auth.login_failed',...
  entity       text,
  entity_id    uuid,
  before       jsonb,
  after        jsonb,
  ip           inet,
  request_id   text
);
CREATE INDEX audit_logs_at_idx ON audit_logs (at);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity, entity_id);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id);
CREATE INDEX audit_logs_approved_by_idx ON audit_logs (approved_by);
CREATE INDEX audit_logs_device_idx ON audit_logs (device_id);

-- Penomoran dokumen gap-free per prefix/perangkat/bulan — PRD §6.7 (D-8: kode tipe ala iPOS)
CREATE TABLE doc_sequences (
  prefix       text NOT NULL,          -- KSR, JL, RJ, PO, BL, RB, AB, OP, PS, MG, RK, KM, KK, BP, BH, SH
  device_code  varchar(3) NOT NULL,
  period       text NOT NULL,          -- YYMM (reset bulanan)
  last_no      integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (prefix, device_code, period)
);

-- Idempotensi sync push & Idempotency-Key desktop — rules/sync-standards.md
CREATE TABLE sync_ops (
  op_id        uuid PRIMARY KEY,                    -- dibuat klien
  device_id    uuid NOT NULL REFERENCES devices(id),
  op_type      text NOT NULL,                       -- 'sale.create','opname.count',...
  status       text NOT NULL CHECK (status IN ('APPLIED','REJECTED')),
  result       jsonb NOT NULL,                      -- respons yang diputar ulang untuk DUPLICATE
  device_time  timestamptz,
  received_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX sync_ops_device_idx ON sync_ops (device_id, received_at);

-- Migrasi dari sistem lama (iPOS 5) — PRD §5.9 FR-MIG
CREATE TABLE import_batches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system  text NOT NULL CHECK (source_system IN ('IPOS5','EXCEL','MANUAL')),
  source_file    text NOT NULL,                     -- nama file saja, bukan path
  source_sha256  text NOT NULL,
  source_dump_at timestamptz,                       -- waktu backup iPOS dibuat (header dump) — cek "backup terbaru?"
  purpose        text NOT NULL CHECK (purpose IN ('DEVELOPMENT','REHEARSAL','GO_LIVE')),  -- plan/go-live-migrasi.md
  scope          jsonb NOT NULL DEFAULT '[]'::jsonb, -- ["master","stock","receivables","history","opening_pickups"]
  status         text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','COMMITTED','FAILED','DISCARDED')),
                 -- DISCARDED = data hasil batch ini dihapus lewat "Reset data persiapan" sebelum go-live
  summary        jsonb NOT NULL DEFAULT '{}'::jsonb, -- jumlah per entitas, peringatan kualitas data (DQ-*)
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  created_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_batches_created_by_idx ON import_batches (created_by);

-- Jejak kunci lama → id baru, untuk setiap entitas hasil impor (kode item iPOS, PLxxxx, no. nota…)
CREATE TABLE legacy_refs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id  uuid NOT NULL REFERENCES import_batches(id),
  source_system    text NOT NULL,
  entity           text NOT NULL,                   -- 'product','customer','supplier','sale','receivable',...
  legacy_key       text NOT NULL,                   -- mis. 'KCL MAHKOTA', 'PL0365', '0000720/KSR/UTM/0426'
  entity_id        uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX legacy_refs_key_uq ON legacy_refs (source_system, entity, legacy_key);
CREATE INDEX legacy_refs_entity_idx ON legacy_refs (entity, entity_id);
CREATE INDEX legacy_refs_batch_idx ON legacy_refs (import_batch_id);

-- =============================================================================
-- 2. MASTER DATA (semua disinkron → deleted_at + index updated_at)
-- =============================================================================
CREATE TABLE units (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,                        -- PCS, BTL, DUS, PAK, SAK, KG, LTR, ...
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
  code        text NOT NULL,                        -- LACI, KAS_TOKO, BANK_BRI, ...
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
  code             text NOT NULL,                   -- CASH, QRIS, TRANSFER, CREDIT
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
  avg_cost            numeric(18,4) NOT NULL DEFAULT 0,   -- HPP rata-rata bergerak per satuan dasar
  last_purchase_cost  numeric(18,4),
  attributes          jsonb NOT NULL DEFAULT '{}'::jsonb, -- atribut dinamis (FR-MD-05)
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CHECK (item_type NOT IN ('BUNDLE','SERVICE') OR track_stock = false)
);
CREATE UNIQUE INDEX products_sku_uq ON products (upper(sku)) WHERE deleted_at IS NULL;
CREATE INDEX products_name_trgm ON products USING gin (name gin_trgm_ops);
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

-- =============================================================================
-- 3. INVENTORI
-- =============================================================================
CREATE TABLE stock_balances (
  product_id    uuid NOT NULL REFERENCES products(id),
  warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
  qty           numeric(18,4) NOT NULL DEFAULT 0,     -- STOK FISIK di gudang, satuan dasar; boleh negatif bila hasil sync (FR-INV-10)
  reserved_qty  numeric(18,4) NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),  -- sudah terjual, BELUM DIAMBIL (FR-PKP)
  -- stok tersedia untuk dijual = qty − reserved_qty (dihitung, tidak disimpan)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, warehouse_id)
);
CREATE INDEX stock_balances_warehouse_idx ON stock_balances (warehouse_id);
CREATE INDEX stock_balances_updated_idx ON stock_balances (updated_at);

CREATE TABLE stock_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq             bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  product_id      uuid NOT NULL REFERENCES products(id),
  warehouse_id    uuid NOT NULL REFERENCES warehouses(id),
  moved_at        timestamptz NOT NULL,               -- waktu bisnis dokumen
  qty             numeric(18,4) NOT NULL CHECK (qty <> 0),   -- + masuk, − keluar (satuan dasar)
  unit_cost       numeric(18,4) NOT NULL,             -- HPP per satuan dasar saat mutasi
  avg_cost_after  numeric(18,4) NOT NULL,             -- products.avg_cost setelah mutasi (audit HPP)
  source_type     text NOT NULL CHECK (source_type IN (
                    'OPENING','SALE','SALE_PICKUP','SALE_PICKUP_CANCEL','SALE_VOID','SALE_RETURN',
                    'PURCHASE_RECEIPT','PURCHASE_RETURN',
                    'OPNAME','ADJUSTMENT','TRANSFER_OUT','TRANSFER_IN',
                    'ASSEMBLY_OUT','ASSEMBLY_IN')),
  source_id       uuid NOT NULL,
  source_line_id  uuid,
  note            text,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX stock_movements_card_idx ON stock_movements (product_id, warehouse_id, moved_at, seq);
CREATE INDEX stock_movements_source_idx ON stock_movements (source_type, source_id);
CREATE INDEX stock_movements_warehouse_idx ON stock_movements (warehouse_id);
CREATE INDEX stock_movements_created_by_idx ON stock_movements (created_by);

CREATE TABLE stock_opnames (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number        text NOT NULL UNIQUE,
  warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
  scope         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- filter kategori/rak saat sesi dibuat
  status        text NOT NULL DEFAULT 'COUNTING' CHECK (status IN ('COUNTING','POSTED','CANCELLED')),
  note          text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  posted_at     timestamptz,
  created_by    uuid NOT NULL REFERENCES users(id),
  posted_by     uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_opnames_warehouse_idx ON stock_opnames (warehouse_id);
CREATE INDEX stock_opnames_created_by_idx ON stock_opnames (created_by);
CREATE INDEX stock_opnames_posted_by_idx ON stock_opnames (posted_by);
CREATE INDEX stock_opnames_updated_idx ON stock_opnames (updated_at);

CREATE TABLE stock_opname_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opname_id     uuid NOT NULL REFERENCES stock_opnames(id) ON DELETE CASCADE,
  product_id    uuid NOT NULL REFERENCES products(id),
  counted_qty   numeric(18,4) NOT NULL CHECK (counted_qty >= 0),  -- satuan dasar
  system_qty    numeric(18,4),                       -- snapshot saat POSTING (bukan saat sesi dibuat)
  diff_qty      numeric(18,4),
  unit_cost     numeric(18,4),
  counted_by    uuid REFERENCES users(id),
  device_id     uuid REFERENCES devices(id),
  client_op_id  uuid UNIQUE,                         -- hitungan dari HP (sync push)
  counted_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX stock_opname_lines_uq ON stock_opname_lines (opname_id, product_id);
CREATE INDEX stock_opname_lines_product_idx ON stock_opname_lines (product_id);
CREATE INDEX stock_opname_lines_counted_by_idx ON stock_opname_lines (counted_by);
CREATE INDEX stock_opname_lines_device_idx ON stock_opname_lines (device_id);

CREATE TABLE stock_adjustments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number        text NOT NULL UNIQUE,
  warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
  reason_code   text NOT NULL CHECK (reason_code IN ('DAMAGED','LOST','EXPIRED','SAMPLE','OTHER')),
  note          text,
  trx_at        timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (reason_code <> 'OTHER' OR note IS NOT NULL)
);
CREATE INDEX stock_adjustments_warehouse_idx ON stock_adjustments (warehouse_id);
CREATE INDEX stock_adjustments_created_by_idx ON stock_adjustments (created_by);

CREATE TABLE stock_adjustment_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_id  uuid NOT NULL REFERENCES stock_adjustments(id),
  product_id     uuid NOT NULL REFERENCES products(id),
  qty            numeric(18,4) NOT NULL CHECK (qty <> 0),   -- bertanda, satuan dasar
  unit_cost      numeric(18,4) NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_adjustment_lines_adj_idx ON stock_adjustment_lines (adjustment_id);
CREATE INDEX stock_adjustment_lines_product_idx ON stock_adjustment_lines (product_id);

CREATE TABLE stock_transfers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number             text NOT NULL UNIQUE,
  from_warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
  to_warehouse_id    uuid NOT NULL REFERENCES warehouses(id),
  trx_at             timestamptz NOT NULL DEFAULT now(),
  note               text,
  created_by         uuid NOT NULL REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (from_warehouse_id <> to_warehouse_id)
);
CREATE INDEX stock_transfers_from_idx ON stock_transfers (from_warehouse_id);
CREATE INDEX stock_transfers_to_idx ON stock_transfers (to_warehouse_id);
CREATE INDEX stock_transfers_created_by_idx ON stock_transfers (created_by);

CREATE TABLE stock_transfer_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id  uuid NOT NULL REFERENCES stock_transfers(id),
  product_id   uuid NOT NULL REFERENCES products(id),
  qty          numeric(18,4) NOT NULL CHECK (qty > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_transfer_lines_transfer_idx ON stock_transfer_lines (transfer_id);
CREATE INDEX stock_transfer_lines_product_idx ON stock_transfer_lines (product_id);

CREATE TABLE assemblies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number         text NOT NULL UNIQUE,
  product_id     uuid NOT NULL REFERENCES products(id),     -- hasil (item_type ASSEMBLY)
  warehouse_id   uuid NOT NULL REFERENCES warehouses(id),
  qty            numeric(18,4) NOT NULL CHECK (qty > 0),    -- satuan dasar hasil
  extra_cost     numeric(18,2) NOT NULL DEFAULT 0 CHECK (extra_cost >= 0),
  unit_cost      numeric(18,4),                             -- dihitung saat posting
  trx_at         timestamptz NOT NULL DEFAULT now(),
  note           text,
  created_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assemblies_product_idx ON assemblies (product_id);
CREATE INDEX assemblies_warehouse_idx ON assemblies (warehouse_id);
CREATE INDEX assemblies_created_by_idx ON assemblies (created_by);

CREATE TABLE assembly_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_id   uuid NOT NULL REFERENCES assemblies(id),
  product_id    uuid NOT NULL REFERENCES products(id),      -- komponen
  qty           numeric(18,4) NOT NULL CHECK (qty > 0),
  unit_cost     numeric(18,4) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assembly_lines_assembly_idx ON assembly_lines (assembly_id);
CREATE INDEX assembly_lines_product_idx ON assembly_lines (product_id);

-- =============================================================================
-- 4. PENJUALAN, SHIFT & KAS
-- =============================================================================
CREATE TABLE shifts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number           text NOT NULL UNIQUE,
  device_id        uuid NOT NULL REFERENCES devices(id),
  cashier_id       uuid NOT NULL REFERENCES users(id),
  status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  opened_at        timestamptz NOT NULL DEFAULT now(),
  opening_cash     numeric(18,2) NOT NULL CHECK (opening_cash >= 0),
  opening_denominations jsonb,
  closed_at        timestamptz,
  closed_by        uuid REFERENCES users(id),
  expected_cash    numeric(18,2),
  counted_cash     numeric(18,2),
  cash_difference  numeric(18,2),
  closing_denominations jsonb,
  closing_note     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'OPEN' OR (closed_at IS NOT NULL AND counted_cash IS NOT NULL)),
  CHECK (cash_difference IS NULL OR cash_difference = 0 OR closing_note IS NOT NULL)
);
CREATE UNIQUE INDEX shifts_one_open_per_device_uq ON shifts (device_id) WHERE status = 'OPEN';
CREATE INDEX shifts_cashier_idx ON shifts (cashier_id);
CREATE INDEX shifts_closed_by_idx ON shifts (closed_by);
CREATE INDEX shifts_opened_at_idx ON shifts (opened_at);

CREATE TABLE sales (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number             text UNIQUE,                     -- NULL selama HELD; impor iPOS memakai nomor asli
  status             text NOT NULL CHECK (status IN ('HELD','COMPLETED','VOIDED')),
  channel            text NOT NULL DEFAULT 'KASIR' CHECK (channel IN ('KASIR','FAKTUR')),  -- D-1: KSR vs JL
  source             text NOT NULL DEFAULT 'APP' CHECK (source IN ('APP','SYNC','IPOS_IMPORT','OPENING_PICKUP')),
                     -- IPOS_IMPORT = histori tanpa mutasi stok; OPENING_PICKUP = saldo awal barang belum diambil saat go-live
                     -- (dikecualikan dari laporan penjualan/laba — omzetnya sudah tercatat di iPOS)
  device_id          uuid NOT NULL REFERENCES devices(id),
  shift_id           uuid REFERENCES shifts(id),      -- wajib saat COMPLETED dari kasir
  cashier_id         uuid NOT NULL REFERENCES users(id),
  customer_id        uuid NOT NULL REFERENCES customers(id),
  customer_group_id  uuid REFERENCES customer_groups(id),  -- snapshot saat transaksi
  warehouse_id       uuid NOT NULL REFERENCES warehouses(id),
  trx_at             timestamptz NOT NULL DEFAULT now(),   -- waktu bisnis (dari perangkat)
  hold_label         text,
  subtotal           numeric(18,2) NOT NULL DEFAULT 0,     -- Σ line_total sebelum diskon nota
  discount_amount    numeric(18,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),  -- diskon nota
  tax_amount         numeric(18,2) NOT NULL DEFAULT 0,     -- PPN (termasuk dalam harga bila inclusive)
  other_charges      numeric(18,2) NOT NULL DEFAULT 0 CHECK (other_charges >= 0),  -- D-4: biaya lain / ongkos angkut
  other_charges_note text,
  rounding_amount    numeric(18,2) NOT NULL DEFAULT 0,
  total              numeric(18,2) NOT NULL DEFAULT 0,     -- subtotal − discount_amount + other_charges + rounding_amount (+ tax bila exclusive)
  fulfillment_status text NOT NULL DEFAULT 'TAKEN'
                     CHECK (fulfillment_status IN ('TAKEN','PENDING','PARTIAL','COMPLETE','CANCELLED')),
                     -- D-5 / FR-PKP: TAKEN = semua dibawa saat bayar; PENDING = belum ada yang diambil;
                     -- PARTIAL = sebagian diambil; COMPLETE = semua sudah diambil (lewat sale_pickups);
                     -- CANCELLED = sisa yang belum diambil dibatalkan (retur/void)
  pickup_planned_date date,                                -- janji ambil ("minggu depan")
  pickup_note        text,
  paid_amount        numeric(18,2) NOT NULL DEFAULT 0,     -- Σ pembayaran non-kredit
  credit_amount      numeric(18,2) NOT NULL DEFAULT 0,     -- porsi piutang
  change_amount      numeric(18,2) NOT NULL DEFAULT 0,
  due_date           date,                                 -- bila credit_amount > 0
  note               text,
  approved_by        uuid REFERENCES users(id),            -- otorisasi (harga/diskon/limit)
  voided_at          timestamptz,
  voided_by          uuid REFERENCES users(id),
  void_reason        text,
  client_op_id       uuid UNIQUE,                          -- idempotensi (desktop & sync)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'HELD' OR number IS NOT NULL),
  CHECK (credit_amount = 0 OR due_date IS NOT NULL),
  CHECK (channel = 'FAKTUR' OR credit_amount = 0),   -- kredit hanya lewat Faktur; "belum diambil" boleh di kedua mode (pelanggan wajib bernama — dicek service)
  CHECK (status <> 'VOIDED' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL))
);
CREATE INDEX sales_trx_at_idx ON sales (trx_at) WHERE status = 'COMPLETED';
CREATE INDEX sales_fulfillment_open_idx ON sales (customer_id) WHERE fulfillment_status IN ('PENDING','PARTIAL');
CREATE INDEX sales_status_idx ON sales (status) WHERE status = 'HELD';
CREATE INDEX sales_shift_idx ON sales (shift_id);
CREATE INDEX sales_customer_idx ON sales (customer_id, trx_at);
CREATE INDEX sales_device_idx ON sales (device_id);
CREATE INDEX sales_cashier_idx ON sales (cashier_id);
CREATE INDEX sales_group_idx ON sales (customer_group_id);
CREATE INDEX sales_warehouse_idx ON sales (warehouse_id);
CREATE INDEX sales_approved_by_idx ON sales (approved_by);
CREATE INDEX sales_voided_by_idx ON sales (voided_by);

CREATE TABLE sale_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id             uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,  -- cascade hanya relevan untuk HELD
  line_no             integer NOT NULL,
  product_id          uuid NOT NULL REFERENCES products(id),
  product_unit_id     uuid NOT NULL REFERENCES product_units(id),
  product_name        text NOT NULL,                      -- snapshot untuk struk/riwayat
  unit_code           text NOT NULL,                      -- snapshot
  conversion_qty      numeric(18,4) NOT NULL,             -- snapshot konversi
  qty                 numeric(18,4) NOT NULL CHECK (qty > 0),     -- dalam satuan baris
  base_qty            numeric(18,4) NOT NULL CHECK (base_qty > 0),-- qty × conversion_qty
  unit_price          numeric(18,2) NOT NULL CHECK (unit_price >= 0),
  list_price          numeric(18,2),                      -- harga hasil resolusi master saat transaksi (D-2: ukur seberapa sering harga diubah)
  price_source        text NOT NULL CHECK (price_source IN ('RETAIL','TIER','GROUP','GROUP_TIER','MANUAL')),
  discount_amount     numeric(18,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),   -- diskon baris
  allocated_discount  numeric(18,2) NOT NULL DEFAULT 0,   -- alokasi diskon nota (FR-POS-06)
  line_total          numeric(18,2) NOT NULL,             -- qty × unit_price − discount_amount
  net_amount          numeric(18,2) NOT NULL,             -- line_total − allocated_discount − porsi PPN (dasar laba)
  cost_per_base       numeric(18,4),                      -- HPP rata-rata tertimbang dari barang yang SUDAH keluar gudang (saat bayar + tiap pengambilan);
                                                          -- selama masih ada sisa belum diambil, laporan laba memakai HPP saat ini untuk sisa itu (estimasi).
                                                          -- NULL = tidak diketahui (histori iPOS, DQ-3)
  cost_total          numeric(18,2),
  picked_up_qty       numeric(18,4) NOT NULL DEFAULT 0,   -- FR-PKP: sudah diambil/diantar (satuan baris); = qty bila dibawa saat bayar
  cancelled_qty       numeric(18,4) NOT NULL DEFAULT 0,   -- sisa belum diambil yang dibatalkan (retur sebelum ambil)
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sale_items ADD CHECK (picked_up_qty >= 0 AND cancelled_qty >= 0 AND picked_up_qty + cancelled_qty <= qty);
-- sisa belum diambil per baris = qty − picked_up_qty − cancelled_qty
CREATE UNIQUE INDEX sale_items_line_uq ON sale_items (sale_id, line_no);
CREATE INDEX sale_items_product_idx ON sale_items (product_id);
CREATE INDEX sale_items_unit_idx ON sale_items (product_unit_id);

CREATE TABLE sale_payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id            uuid NOT NULL REFERENCES sales(id),
  payment_method_id  uuid NOT NULL REFERENCES payment_methods(id),
  amount             numeric(18,2) NOT NULL CHECK (amount > 0),   -- untuk CASH: uang diterima (sebelum kembalian)
  reference          text,                                        -- no. ref transfer / QRIS
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sale_payments_sale_idx ON sale_payments (sale_id);
CREATE INDEX sale_payments_method_idx ON sale_payments (payment_method_id);

-- Pengambilan barang (terjual, diambil belakangan) — FR-PKP, plan/feature-pengambilan-barang.md.
-- Saat nota selesai dengan "belum diambil": stok fisik TIDAK berkurang, hanya
-- stock_balances.reserved_qty bertambah. Dokumen pengambilan inilah yang
-- mengeluarkan barang dari gudang: stock_movements SALE_PICKUP (qty fisik −,
-- reserved −). Satu pengambilan boleh mencakup beberapa nota pelanggan yang sama.
-- Riwayat pengambilan append-only: koreksi = pembatalan (status CANCELLED + mutasi balik), tidak pernah diedit.
CREATE TABLE sale_pickups (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number         text NOT NULL UNIQUE,                 -- AB/K01/2610/00001 (Ambil Barang)
  customer_id    uuid NOT NULL REFERENCES customers(id),
  warehouse_id   uuid NOT NULL REFERENCES warehouses(id),
  status         text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','CANCELLED')),
  method         text NOT NULL DEFAULT 'PICKUP' CHECK (method IN ('PICKUP','DELIVERY')),  -- diambil sendiri / diantar toko
  picked_up_at   timestamptz NOT NULL DEFAULT now(),
  receiver_name  text NOT NULL,                        -- yang mengambil / menerima (bisa diwakilkan)
  receiver_phone text,
  vehicle        text,                                 -- no. polisi / jenis kendaraan
  driver_name    text,
  destination    text,                                 -- untuk DELIVERY: ladang / alamat kebun
  note           text,
  created_by     uuid NOT NULL REFERENCES users(id),   -- admin yang menginput
  device_id      uuid NOT NULL REFERENCES devices(id),
  cancelled_at   timestamptz,
  cancelled_by   uuid REFERENCES users(id),
  cancel_reason  text,
  client_op_id   uuid UNIQUE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (method = 'PICKUP' OR destination IS NOT NULL),
  CHECK (status = 'POSTED' OR (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL))
);
CREATE INDEX sale_pickups_customer_idx ON sale_pickups (customer_id, picked_up_at);
CREATE INDEX sale_pickups_warehouse_idx ON sale_pickups (warehouse_id);
CREATE INDEX sale_pickups_created_by_idx ON sale_pickups (created_by);
CREATE INDEX sale_pickups_cancelled_by_idx ON sale_pickups (cancelled_by);
CREATE INDEX sale_pickups_device_idx ON sale_pickups (device_id);
CREATE INDEX sale_pickups_picked_up_at_idx ON sale_pickups (picked_up_at);

CREATE TABLE sale_pickup_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_id      uuid NOT NULL REFERENCES sale_pickups(id),
  sale_item_id   uuid NOT NULL REFERENCES sale_items(id),
  qty            numeric(18,4) NOT NULL CHECK (qty > 0),   -- satuan baris nota (≤ sisa belum diambil)
  base_qty       numeric(18,4) NOT NULL CHECK (base_qty > 0),
  unit_cost      numeric(18,4) NOT NULL,                   -- HPP per satuan dasar saat barang keluar
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sale_pickup_items_pickup_idx ON sale_pickup_items (pickup_id);
CREATE INDEX sale_pickup_items_sale_item_idx ON sale_pickup_items (sale_item_id);

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

-- =============================================================================
-- 5. PEMBELIAN
-- =============================================================================
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
  unit_cost           numeric(18,4) NOT NULL,       -- avg_cost saat keluar (PRD §6.6)
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_return_items_return_idx ON purchase_return_items (purchase_return_id);
CREATE INDEX purchase_return_items_product_idx ON purchase_return_items (product_id);
CREATE INDEX purchase_return_items_unit_idx ON purchase_return_items (product_unit_id);

-- =============================================================================
-- 6. HUTANG & PIUTANG
-- =============================================================================
CREATE TABLE receivables (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL REFERENCES customers(id),
  source_type   text NOT NULL CHECK (source_type IN ('SALE','OPENING')),
  source_id     uuid,                                  -- sales.id; NULL untuk OPENING
  doc_number    text NOT NULL,
  doc_date      date NOT NULL,
  due_date      date NOT NULL,
  amount        numeric(18,2) NOT NULL CHECK (amount > 0),
  paid_amount   numeric(18,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),  -- termasuk potongan retur
  status        text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PARTIAL','PAID','WRITTEN_OFF','VOIDED')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (paid_amount <= amount),
  CHECK (source_type = 'OPENING' OR source_id IS NOT NULL)
);
CREATE UNIQUE INDEX receivables_source_uq ON receivables (source_type, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX receivables_customer_open_idx ON receivables (customer_id) WHERE status IN ('OPEN','PARTIAL');
CREATE INDEX receivables_due_open_idx ON receivables (due_date) WHERE status IN ('OPEN','PARTIAL');
CREATE INDEX receivables_customer_idx ON receivables (customer_id);

CREATE TABLE receivable_payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number             text NOT NULL UNIQUE,
  customer_id        uuid NOT NULL REFERENCES customers(id),
  paid_at            timestamptz NOT NULL DEFAULT now(),
  payment_method_id  uuid NOT NULL REFERENCES payment_methods(id),
  shift_id           uuid REFERENCES shifts(id),       -- bila diterima tunai di laci kasir
  amount             numeric(18,2) NOT NULL CHECK (amount > 0),
  reference          text,
  note               text,
  created_by         uuid NOT NULL REFERENCES users(id),
  client_op_id       uuid UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX receivable_payments_customer_idx ON receivable_payments (customer_id, paid_at);
CREATE INDEX receivable_payments_method_idx ON receivable_payments (payment_method_id);
CREATE INDEX receivable_payments_shift_idx ON receivable_payments (shift_id);
CREATE INDEX receivable_payments_created_by_idx ON receivable_payments (created_by);

CREATE TABLE receivable_payment_allocations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receivable_payment_id  uuid REFERENCES receivable_payments(id),
  sale_return_id         uuid REFERENCES sale_returns(id),       -- potongan dari retur jual
  receivable_id          uuid NOT NULL REFERENCES receivables(id),
  amount                 numeric(18,2) NOT NULL CHECK (amount > 0),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(receivable_payment_id, sale_return_id) = 1)
);
CREATE INDEX receivable_alloc_payment_idx ON receivable_payment_allocations (receivable_payment_id);
CREATE INDEX receivable_alloc_return_idx ON receivable_payment_allocations (sale_return_id);
CREATE INDEX receivable_alloc_receivable_idx ON receivable_payment_allocations (receivable_id);

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

CREATE TABLE payable_payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number             text NOT NULL UNIQUE,
  supplier_id        uuid NOT NULL REFERENCES suppliers(id),
  paid_at            timestamptz NOT NULL DEFAULT now(),
  payment_method_id  uuid NOT NULL REFERENCES payment_methods(id),
  amount             numeric(18,2) NOT NULL CHECK (amount > 0),
  reference          text,
  note               text,
  created_by         uuid NOT NULL REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payable_payments_supplier_idx ON payable_payments (supplier_id, paid_at);
CREATE INDEX payable_payments_method_idx ON payable_payments (payment_method_id);
CREATE INDEX payable_payments_created_by_idx ON payable_payments (created_by);

CREATE TABLE payable_payment_allocations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payable_payment_id  uuid REFERENCES payable_payments(id),
  purchase_return_id  uuid REFERENCES purchase_returns(id),   -- potongan dari retur beli
  payable_id          uuid NOT NULL REFERENCES payables(id),
  amount              numeric(18,2) NOT NULL CHECK (amount > 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(payable_payment_id, purchase_return_id) = 1)
);
CREATE INDEX payable_alloc_payment_idx ON payable_payment_allocations (payable_payment_id);
CREATE INDEX payable_alloc_return_idx ON payable_payment_allocations (purchase_return_id);
CREATE INDEX payable_alloc_payable_idx ON payable_payment_allocations (payable_id);

-- =============================================================================
-- 7. BUKU KAS (append-only) — FR-FIN-01..03
-- =============================================================================
CREATE TABLE cash_transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number            text UNIQUE,                       -- KM/KK untuk input manual; NULL untuk otomatis
  cash_account_id   uuid NOT NULL REFERENCES cash_accounts(id),
  shift_id          uuid REFERENCES shifts(id),        -- wajib bila akun DRAWER
  cash_category_id  uuid NOT NULL REFERENCES cash_categories(id),
  trx_at            timestamptz NOT NULL DEFAULT now(),
  direction         text NOT NULL CHECK (direction IN ('IN','OUT')),
  amount            numeric(18,2) NOT NULL CHECK (amount > 0),
  source_type       text NOT NULL CHECK (source_type IN (
                      'SALE','SALE_VOID','SALE_RETURN','AR_PAYMENT','AP_PAYMENT',
                      'PURCHASE_INVOICE','PURCHASE_RETURN','SHIFT_OPEN','MANUAL','TRANSFER')),
  source_id         uuid,
  note              text,
  created_by        uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX cash_transactions_account_idx ON cash_transactions (cash_account_id, trx_at);
CREATE INDEX cash_transactions_shift_idx ON cash_transactions (shift_id);
CREATE INDEX cash_transactions_category_idx ON cash_transactions (cash_category_id);
CREATE INDEX cash_transactions_source_idx ON cash_transactions (source_type, source_id);
CREATE INDEX cash_transactions_created_by_idx ON cash_transactions (created_by);

-- =============================================================================
-- 8. TRIGGER
-- =============================================================================
-- updated_at otomatis untuk setiap tabel yang punya kolom updated_at
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at'
      AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t.table_name || '_set_updated_at', t.table_name);
  END LOOP;
END $$;

-- Ledger append-only
CREATE TRIGGER stock_movements_append_only
  BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER cash_transactions_append_only
  BEFORE UPDATE OR DELETE ON cash_transactions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- =============================================================================
-- 9. DATA AWAL (seed sistem — data toko diisi wizard first-run / importer iPOS)
--    Grup pelanggan lain (Bronze/Silver/Gold/RAM 1/RAM 2), kategori, item,
--    pelanggan, supplier dan rekening bank datang dari importer (FR-MIG).
-- =============================================================================
INSERT INTO customer_groups (code, name) VALUES ('UMUM', 'Umum');

INSERT INTO cash_accounts (code, name, kind) VALUES
  ('LACI', 'Laci Kasir', 'DRAWER'), ('KAS_TOKO', 'Kas Toko', 'CASH');

INSERT INTO cash_categories (code, name, direction, is_system, is_operating_expense) VALUES
  ('SALES',        'Penjualan',              'IN',   true,  false),
  ('SALE_REFUND',  'Pengembalian Penjualan', 'OUT',  true,  false),
  ('AR_PAYMENT',   'Pelunasan Piutang',      'IN',   true,  false),
  ('PURCHASE',     'Pembelian Tunai',        'OUT',  true,  false),
  ('AP_PAYMENT',   'Pembayaran Hutang',      'OUT',  true,  false),
  ('PURCHASE_REFUND','Pengembalian Pembelian','IN',  true,  false),
  ('OPENING_CASH', 'Modal Awal Shift',       'IN',   true,  false),
  ('TRANSFER',     'Setoran / Transfer Kas', 'BOTH', true,  false),
  ('CAPITAL',      'Modal Owner',            'IN',   true,  false),
  ('DRAWING',      'Prive Owner',            'OUT',  true,  false),
  ('OPEX_EXPEDITION', 'Biaya Ekspedisi',        'OUT', false, true),
  ('OPEX_UNLOADING',  'Upah Bongkar Muat',      'OUT', false, true),
  ('OPEX_VEHICLE',    'BBM & Perbaikan Kendaraan','OUT', false, true),
  ('OPEX_WAGES',      'Upah / Gaji',            'OUT', false, true),
  ('OPEX_GENERAL',    'Biaya Operasional Lain', 'OUT', false, true);
-- Kategori OPEX di atas = pola 498 kas keluar iPOS (Analisis §2).

INSERT INTO payment_methods (code, name, kind, sort_order) VALUES
  ('CASH',   'Tunai',   'CASH',   1),
  ('CREDIT', 'Piutang', 'CREDIT', 9);
-- QRIS & TRANSFER dibuat di wizard karena butuh cash_account BANK tujuan.

-- Satuan = daftar tbl_itemsatuan iPOS (kode dipertahankan agar akrab bagi toko: ZAK, bukan SAK)
INSERT INTO units (code, name) VALUES
  ('PCS','Pcs'), ('BTL','Botol'), ('LTR','Liter'), ('GLN','Galon'), ('PAIL','Pail'),
  ('KG','Kilogram'), ('ZAK','Zak'), ('GRAM','Gram'), ('BOX','Box'), ('DUS','Dus'), ('PAK','Pak');
