-- 0003_inventory — stok, ledger, lapisan HPP FIFO, penyesuaian, stok opname (Sprint 4).
-- Sumber: .claude/File Skema/Mandiri Tani v1.0/mandiri_tani_schema.sql bagian 3 (tanpa mutasi
-- gudang & perakitan — Could, belum dipakai toko). Forward-only: JANGAN ubah setelah diterapkan.

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
  unit_cost       numeric(18,4) NOT NULL,             -- HPP per satuan dasar: masuk = harga lapisan baru; keluar = rata-rata tertimbang lapisan FIFO yang terpakai
  cost_estimated  boolean NOT NULL DEFAULT false,     -- true bila sebagian keluar tanpa lapisan (stok minus) → harga beli terakhir
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

-- Lapisan HPP FIFO (ADR-04, PRD §6.6). Satu baris per barang masuk berbiaya.
-- qty_remaining dikurangi oleh pemakaian (tertua dulu); hanya stockService yang mengubahnya.
CREATE TABLE stock_cost_layers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       uuid NOT NULL REFERENCES products(id),
  warehouse_id     uuid NOT NULL REFERENCES warehouses(id),
  received_at      timestamptz NOT NULL,              -- urutan FIFO (pembalikan memakai tanggal lapisan asal)
  qty_in           numeric(18,4) NOT NULL CHECK (qty_in > 0),        -- satuan dasar
  qty_remaining    numeric(18,4) NOT NULL CHECK (qty_remaining >= 0 AND qty_remaining <= qty_in),
  unit_cost        numeric(18,4) NOT NULL CHECK (unit_cost >= 0),
  source_movement_id uuid NOT NULL REFERENCES stock_movements(id),   -- mutasi masuk yang membuat lapisan
  source_type      text NOT NULL,                     -- salinan stock_movements.source_type (PURCHASE_RECEIPT, OPENING, ...)
  source_line_id   uuid,                              -- mis. goods_receipt_items.id → retur beli memakai lapisan asalnya dulu
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_cost_layers_fifo_idx ON stock_cost_layers (product_id, warehouse_id, received_at, id)
  WHERE qty_remaining > 0;
CREATE INDEX stock_cost_layers_source_movement_idx ON stock_cost_layers (source_movement_id);
CREATE INDEX stock_cost_layers_source_line_idx ON stock_cost_layers (source_line_id);
CREATE INDEX stock_cost_layers_warehouse_idx ON stock_cost_layers (warehouse_id);

-- Pemakaian lapisan oleh mutasi keluar (append-only). layer_id NULL = kekurangan tanpa lapisan (stok minus, HPP estimasi).
CREATE TABLE stock_layer_consumptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_id   uuid NOT NULL REFERENCES stock_movements(id),
  layer_id      uuid REFERENCES stock_cost_layers(id),
  qty           numeric(18,4) NOT NULL CHECK (qty > 0),   -- satuan dasar
  unit_cost     numeric(18,4) NOT NULL,
  is_estimated  boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (layer_id IS NOT NULL OR is_estimated)
);
CREATE INDEX stock_layer_consumptions_movement_idx ON stock_layer_consumptions (movement_id);
CREATE INDEX stock_layer_consumptions_layer_idx ON stock_layer_consumptions (layer_id);

-- created_by boleh NULL sampai Sprint 2 (keputusan S4-1, sama dengan S3-2): dibuat lewat kunci akses lokal.
CREATE TABLE stock_opnames (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number        text NOT NULL UNIQUE,
  warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
  scope         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- filter kategori/rak saat sesi dibuat
  status        text NOT NULL DEFAULT 'COUNTING' CHECK (status IN ('COUNTING','POSTED','CANCELLED')),
  note          text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  posted_at     timestamptz,
  created_by    uuid REFERENCES users(id),
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
  client_op_id  uuid UNIQUE,                         -- Idempotency-Key (backend-standards §3)
  created_by    uuid REFERENCES users(id),
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

SELECT ensure_updated_at_triggers();

-- Ledger append-only (golden rule 5).
CREATE TRIGGER stock_movements_append_only
  BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER stock_layer_consumptions_append_only
  BEFORE UPDATE OR DELETE ON stock_layer_consumptions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
-- stock_cost_layers TIDAK append-only: qty_remaining berkurang saat dipakai (hanya oleh stockService).
