-- 0001_system — fungsi umum + tabel sistem (sumber: .claude/File Skema/Mandiri Tani v1.0/mandiri_tani_schema.sql bagian 0–1).
-- Forward-only: JANGAN ubah file ini setelah diterapkan; buat migrasi baru (database-standards §2).

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
  role             text NOT NULL CHECK (role IN ('OWNER','KASIR')),   -- v1 dua role (D-12); role baru = migrasi CHECK + permissions.ts
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
CREATE INDEX device_pairing_codes_used_by_device_idx ON device_pairing_codes (used_by_device_id);

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

-- Token otorisasi PIN Owner (sekali pakai, satu aksi) — FR-POS-20
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
  approved_by  uuid REFERENCES users(id),          -- pemberi otorisasi (Owner)
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

-- Penomoran dokumen SAMA DENGAN iPOS — PRD §6.7 (Q-16):
--   {URUT}/{TIPE}/{DEPT}/{BLNTHN}  mis. 0001789/JL/UTM/1026
-- Urut per tipe per gudang, reset tiap tahun; saat go-live last_no diisi dari
-- tbl_formatnotr.nomor iPOS sehingga nomor bersambung.
CREATE TABLE doc_sequences (
  doc_type     text NOT NULL,          -- KSR, JL, RJ, BL, RB, BP, KASO, KSIN, PJ, TRF + baru: AB, BH, PS, SH, RK, PO
  dept_code    text NOT NULL,          -- kode gudang, mis. UTM
  year         smallint NOT NULL,      -- reset tahunan
  digits       smallint NOT NULL DEFAULT 4,   -- 7 untuk KSR/JL/BL, 4 lainnya (seperti iPOS)
  last_no      integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_type, dept_code, year)
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

-- -----------------------------------------------------------------------------
-- Pemasang trigger updated_at untuk setiap tabel yang punya kolom updated_at dan
-- belum punya trigger-nya. Dipanggil di akhir SETIAP migrasi yang membuat tabel.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ensure_updated_at_triggers() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = current_schema() AND c.column_name = 'updated_at'
      AND tb.table_type = 'BASE TABLE'
      AND NOT EXISTS (
        SELECT 1 FROM pg_trigger tg
        JOIN pg_class cl ON cl.oid = tg.tgrelid
        WHERE cl.relname = c.table_name AND tg.tgname = c.table_name || '_set_updated_at'
      )
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t.table_name || '_set_updated_at', t.table_name);
  END LOOP;
END $$;

SELECT ensure_updated_at_triggers();

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
