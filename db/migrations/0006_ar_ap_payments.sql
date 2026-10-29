-- 0006_ar_ap_payments — pelunasan piutang (BP) & pembayaran hutang (BH) + alokasinya (Sprint 9).
-- Sumber: .claude/File Skema/Mandiri Tani v1.0/mandiri_tani_schema.sql bagian 6, tanpa perubahan.
-- Alokasi juga mencatat potongan dari retur jual/beli (sale_return_id / purchase_return_id).
-- Forward-only: JANGAN ubah setelah diterapkan.


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

SELECT ensure_updated_at_triggers();
