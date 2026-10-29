-- 0004_sales — penjualan, pengambilan barang, piutang & buku kas (Sprint 6–7).
-- Sumber: .claude/File Skema/Mandiri Tani v1.0/mandiri_tani_schema.sql bagian 4, 6, 7 (tanpa retur —
-- Sprint 8 — dan pembayaran piutang — Sprint 9). `shifts` dibuat agar skema sinkron, tetapi v1 tidak
-- memakai shift (sprint-6 S6-1). Forward-only: JANGAN ubah setelah diterapkan.


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
  number         text NOT NULL UNIQUE,                 -- 0001/AB/UTM/1026 (Ambil Barang)
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
  unit_cost      numeric(18,4) NOT NULL,                   -- HPP FIFO per satuan dasar saat barang keluar
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sale_pickup_items_pickup_idx ON sale_pickup_items (pickup_id);
CREATE INDEX sale_pickup_items_sale_item_idx ON sale_pickup_items (sale_item_id);

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

SELECT ensure_updated_at_triggers();

-- Ledger append-only (golden rule 5).
CREATE TRIGGER cash_transactions_append_only
  BEFORE UPDATE OR DELETE ON cash_transactions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
