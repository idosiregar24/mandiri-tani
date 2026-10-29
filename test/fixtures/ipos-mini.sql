-- SYNTHETIC iPOS 5 subset for importer tests (sprint-3 E9, sprint-14 §3). Column names
-- and types match the real iPOS tables the importer reads; EVERY row is invented — no
-- data from the store's real backup (.claude/file/) may ever be copied here (CLAUDE.md #13).
-- Cases covered: pupuk KG + ZAK = 50 KG with type-S prices, a zero price, an item without
-- any price (DQ-2), a derived unit with conversion 1, an unknown item type, a pupuk sold
-- per PCS (DQ-9), a unit code missing from the app's seed list, walk-in UMUM, customer and
-- supplier codes that are names (DQ-5), a duplicate customer name (DQ-4), groups incl. RAM 1.

CREATE TABLE tbl_itemsatuan (satuan varchar(20), ketsatuan varchar(50), konversi numeric(18,3), satuankonversi varchar(20), utama boolean);
INSERT INTO tbl_itemsatuan VALUES
  ('PCS','PCS',0,NULL,false), ('KG','KG',0,NULL,false), ('ZAK','ZAK',0,NULL,false), ('BTL','BOTOL',0,NULL,false),
  ('LTR','LITER',0,NULL,false), ('BOX','BOX',0,NULL,false), ('IKAT','IKAT',0,NULL,false);

CREATE TABLE tbl_itemjenis (jenis varchar(30), ketjenis varchar(100));
INSERT INTO tbl_itemjenis VALUES ('PUPUK','PUPUK'), ('RACUN','RACUN'), ('ALT','ALAT'), ('BIBIT','BIBIT');

CREATE TABLE tbl_itemmerek (merek varchar(30), ketmerek varchar(100));

CREATE TABLE tbl_item (
  kodeitem varchar(50), namaitem text, jenis varchar(30), tipe varchar(1), satuan varchar(20), stokmin numeric(18,3),
  sistemhargajual varchar(1), hargapokok numeric(18,3), hargajual1 numeric(18,3), merek varchar(30), keterangan text,
  statusjual varchar(1), statushapus varchar(1), stok numeric(18,3)
);
INSERT INTO tbl_item VALUES
  ('UREA CONTOH',      'PUPUK UREA CONTOH',         'PUPUK', '1', 'KG',   0, 'S', 0, 9999,   NULL, NULL, 'Y', NULL, 0),
  ('NPK CONTOH 16',    'NPK CONTOH 16-16-16',       'PUPUK', '1', 'KG',   5, 'S', 0, 0,      NULL, NULL, 'Y', NULL, 0),
  ('RACUN A',          'RACUN CONTOH A 500 ML',     'RACUN', '1', 'BTL',  0, 'O', 0, 85000,  NULL, NULL, 'Y', NULL, 0),
  ('RACUN B',          'RACUN CONTOH B 1 LTR',      'RACUN', '1', 'LTR',  0, 'O', 0, 0,      NULL, NULL, 'Y', NULL, 0),
  ('ALAT 01',          'SEMPROTAN CONTOH',          'ALT',   '1', 'BOX',  0, 'O', 0, 120000, NULL, NULL, 'Y', NULL, 0),
  ('BIBIT 01',         'BIBIT CONTOH F1',           'BIBIT', '2', 'PCS',  0, 'O', 0, 5000,   NULL, NULL, 'Y', NULL, 0),
  ('SP CONTOH',        'PUPUK SP CONTOH',           'PUPUK', '1', 'PCS',  0, 'O', 0, 150000, NULL, NULL, 'Y', NULL, 0),
  ('TALI 01',          'TALI CONTOH',               'ALT',   '1', 'IKAT', 0, 'O', 0, 2000,   NULL, NULL, 'Y', NULL, 0);

CREATE TABLE tbl_itemsatuanjml (iddetail varchar(50), kodeitem varchar(50), satuan varchar(20), jumlahkonv numeric(18,3), kodebarcode varchar(50), hargapokok numeric(18,3), tipe varchar(1));
INSERT INTO tbl_itemsatuanjml VALUES
  ('d1','UREA CONTOH','KG',1,'',0,'D'), ('d2','UREA CONTOH','ZAK',50,'',0,'K'),
  ('d3','NPK CONTOH 16','KG',1,'',0,'D'), ('d4','NPK CONTOH 16','ZAK',50,'',0,'K'),
  ('d5','RACUN A','BTL',1,'8990000000017',0,'D'),
  ('d6','RACUN B','LTR',1,'',0,'D'),
  ('d7','ALAT 01','BOX',1,'',0,'D'), ('d8','ALAT 01','PCS',1,'',0,'K'),
  ('d9','BIBIT 01','PCS',1,'',0,'D'),
  ('d10','SP CONTOH','PCS',1,'',0,'D'),
  ('d11','TALI 01','IKAT',1,'',0,'D');

-- hargajual is an UNBOUNDED numeric in iPOS: values come back as e.g. 15000.00000000000000000000.
CREATE TABLE tbl_itemhj (iddetail varchar(50), kodeitem varchar(50), tipehj varchar(1), jmlsampai numeric(18,3), level integer, prosentase numeric(18,3), satuan varchar(20), hargajual numeric);
INSERT INTO tbl_itemhj VALUES
  ('h1','UREA CONTOH','S',0,0,0,'KG',15000.00000000000000000000), ('h2','UREA CONTOH','S',0,0,0,'ZAK',640000.00000000000000000000),
  ('h3','NPK CONTOH 16','S',0,0,0,'KG',0.00000000000000000000), ('h4','NPK CONTOH 16','S',0,0,0,'ZAK',700000.00000000000000000000),
  -- Level 2 / quantity tiers are not used by the store; the importer ignores them.
  ('h5','UREA CONTOH','S',10,2,0,'ZAK',600000),
  -- A type-O item's tbl_itemhj row is ignored (its price is tbl_item.hargajual1).
  ('h6','BIBIT 01','S',0,0,0,'PCS',4500);

CREATE TABLE tbl_supelgrup (kgrup varchar(30), grup varchar(100), potongan numeric(18,3), levelharga integer, kelipatanpoin numeric(18,3));
INSERT INTO tbl_supelgrup VALUES ('General','General',0,1,0), ('Gold','Gold',10,4,0), ('RAM 1','RAM 1',0,NULL,0);

CREATE TABLE tbl_supel (
  kode varchar(30), tipe varchar(2), nama varchar(150), alamat text, kota varchar(50), telepon varchar(50), kontak varchar(100),
  keterangan text, limitjmlhupi numeric(18,3), harijt integer, kgrup varchar(30), stsaktif varchar(1)
);
INSERT INTO tbl_supel VALUES
  ('UMUM',            'PL', 'UMUM',              NULL,             NULL, NULL,             NULL,     NULL, 0,       0,  'General', 'Y'),
  ('PL0001',          'PL', 'Tani Contoh Satu',  'Dusun Contoh 1', NULL, '0812-0000-0001', NULL,     NULL, 0,       0,  'General', 'Y'),
  ('PL0003',          'PL', 'TANI CONTOH SATU',  NULL,             NULL, NULL,             NULL,     NULL, 0,       0,  'Gold',    'Y'),
  ('PL0007',          'PL', 'Kebun Contoh',      'Desa Contoh',    'Kota Contoh', NULL,    NULL,     'kebun sawit', 5000000, 14, 'RAM 1', 'Y'),
  ('Pak Kode Nama',   'PL', 'Pak Kode Nama',     NULL,             NULL, NULL,             NULL,     NULL, 0,       0,  'General', 'Y'),
  ('PL0009',          'PL', 'Pelanggan Lama',    NULL,             NULL, NULL,             NULL,     NULL, 0,       0,  'General', 'T'),
  ('SP0001',          'SU', 'CV Contoh Agro',    'Jl. Contoh 2',   NULL, '0761 000000',    'Bu Contoh', NULL, 0,    0,  NULL,      'Y'),
  ('CV KODE NAMA',    'SU', 'CV Kode Nama',      NULL,             NULL, NULL,             NULL,     NULL, 0,       30, NULL,      'Y');

CREATE TABLE tbl_bank (kodebank varchar(20), namabank varchar(100), acc_kd varchar(30), acc_kk varchar(30));
INSERT INTO tbl_bank VALUES ('BCA','Bank Central Asia',NULL,NULL), ('MANDIRI','Bank Mandiri',NULL,NULL);

CREATE TABLE tbl_kantor (kodekantor varchar(10), fungsi varchar(50), namakantor varchar(100), stspakai boolean, stsaktif varchar(1));
INSERT INTO tbl_kantor VALUES ('UTM','Utama','TOKO CONTOH',false,'Y'), ('DEP','Cabang Beda Lokasi','DEPO CONTOH',false,'Y');

CREATE TABLE tbl_conf (confname varchar(50), confvalue varchar(255), confblob bytea);
INSERT INTO tbl_conf VALUES ('DEF_JATUH_TEMPO','10',NULL), ('METHOD_HPP','FIFO',NULL), ('JUAL_STOK_HABIS','1',NULL);

-- Sales/purchase lines: only used to pick each item's usual sale/purchase unit (S3-7).
CREATE TABLE tbl_ikhd (notransaksi varchar(50), kodekantor varchar(10), tanggal timestamp, tipe varchar(5), kodesupel varchar(30), jmlkredit numeric DEFAULT 0, krd_jml_byr numeric DEFAULT 0, krd_jml_pot numeric DEFAULT 0, byr_krd_jt timestamp);
CREATE TABLE tbl_ikdt (iddetail varchar(50), notransaksi varchar(50), kodeitem varchar(50), jumlah numeric(18,3), satuan varchar(20), harga numeric(18,3));
INSERT INTO tbl_ikhd VALUES
  ('0000001/KSR/UTM/0126','UTM','2026-01-05 09:00','KSR','UMUM'),
  ('0000001/JL/UTM/0126','UTM','2026-01-06 10:00','JL','PL0001'),
  ('0000002/JL/UTM/0126','UTM','2026-01-07 10:00','JL','PL0007');
INSERT INTO tbl_ikdt VALUES
  ('s1','0000001/KSR/UTM/0126','UREA CONTOH',3,'KG',15000),
  ('s2','0000001/JL/UTM/0126','UREA CONTOH',10,'ZAK',630000),
  ('s3','0000002/JL/UTM/0126','UREA CONTOH',4,'ZAK',640000),
  ('s4','0000002/JL/UTM/0126','RACUN A',2,'BTL',85000);
CREATE TABLE tbl_imhd (notransaksi varchar(50), kodekantor varchar(10), tanggal timestamp, tipe varchar(5), kodesupel varchar(30), jmlkredit numeric DEFAULT 0, krd_jml_byr numeric DEFAULT 0, krd_jml_pot numeric DEFAULT 0, byr_krd_jt timestamp);
CREATE TABLE tbl_imdt (iddetail varchar(50), notransaksi varchar(50), kodeitem varchar(50), jumlah numeric(18,3), satuan varchar(20), harga numeric(18,3));
INSERT INTO tbl_imhd VALUES ('0000001/BL/UTM/0126','UTM','2026-01-02 08:00','BL','SP0001');
INSERT INTO tbl_imdt VALUES ('b1','0000001/BL/UTM/0126','NPK CONTOH 16',100,'ZAK',520000);

-- Credit left (Sprint 9): open = jmlkredit − krd_jml_byr − krd_jml_pot. Cases: partly paid with a
-- deduction, fully paid (ignored), no due date, unknown customer; two open credit purchases.
UPDATE tbl_ikhd SET jmlkredit = 6300000, krd_jml_byr = 1000000, krd_jml_pot = 300000, byr_krd_jt = '2026-01-16' WHERE notransaksi = '0000001/JL/UTM/0126';
UPDATE tbl_ikhd SET jmlkredit = 2690000, krd_jml_byr = 2690000, byr_krd_jt = '2026-01-21' WHERE notransaksi = '0000002/JL/UTM/0126';
INSERT INTO tbl_ikhd VALUES
  ('0000003/JL/UTM/0226','UTM','2026-02-03 10:00','JL','PL0007',1500000,0,0,NULL),
  ('0000004/JL/UTM/0226','UTM','2026-02-04 10:00','JL','PL0404',250000,0,0,'2026-02-14');
UPDATE tbl_imhd SET jmlkredit = 52000000, byr_krd_jt = '2026-01-12' WHERE notransaksi = '0000001/BL/UTM/0126';
INSERT INTO tbl_imhd VALUES ('0000002/BL/UTM/0226','UTM','2026-02-05 08:00','BL','CV KODE NAMA',3000000,0,0,'2026-03-07');

-- Opening stock (Sprint 4). hargadasar is numeric(35,20) in iPOS. Cases: two FIFO layers (one with a
-- 20-decimal cost), a fully used layer (sisa 0, ignored), another office (DEP, ignored), an item with
-- stock but no layer (BIBIT 01), negative stock (SP CONTOH), and stock of an item missing from tbl_item.
CREATE TABLE tbl_item_im (
  iddetail varchar(150), notransaksi varchar(100), kodekantor varchar(50), tanggal timestamp, tipe varchar(20),
  kodeitem varchar(100), jumlahdasar numeric(20,3), hargadasar numeric(35,20), masuk numeric(20,3), sisa numeric(20,3)
);
INSERT INTO tbl_item_im VALUES
  ('im1', '0000001/BL/UTM/0126', 'UTM', '2026-01-02 08:00:00', 'BL', 'UREA CONTOH',   1500, 7100.00000000000000000000, 1500, 1500),
  ('im2', '0000009/BL/UTM/0226', 'UTM', '2026-02-01 09:30:00', 'BL', 'UREA CONTOH',   2500, 7600.12345678901234567890, 2500, 2500),
  ('im3', '0000120/BL/UTM/1225', 'UTM', '2025-12-01 08:00:00', 'BL', 'UREA CONTOH',   1000, 7000.00000000000000000000, 1000, 0),
  ('im4', '0000002/BL/UTM/0126', 'UTM', '2026-01-02 08:05:00', 'BL', 'NPK CONTOH 16', 5000, 10400.00000000000000000000, 5000, 5000),
  ('im5', 'SA-0001',             'UTM', '2025-11-15 07:00:00', 'SA', 'RACUN A',         12, 60000.00000000000000000000, 12, 12),
  ('im6', '0000003/BL/UTM/0126', 'UTM', '2026-01-05 10:00:00', 'BL', 'BARANG HILANG',    5, 5000.00000000000000000000, 5, 5),
  ('im7', '0000001/BL/DEP/0126', 'DEP', '2026-01-03 08:00:00', 'BL', 'UREA CONTOH',    999, 7200.00000000000000000000, 999, 999);

CREATE TABLE tbl_itemstok (kodeitem varchar(100), kantor varchar(50), stok numeric(20,3), hppdasar numeric(35,20));
INSERT INTO tbl_itemstok VALUES
  ('UREA CONTOH',   'UTM', 4000, 7400), ('NPK CONTOH 16', 'UTM', 5000, 10400), ('RACUN A', 'UTM', 12, 60000),
  ('BIBIT 01',      'UTM', 5, 4000),    ('SP CONTOH',     'UTM', -3, 0),       ('BARANG HILANG', 'UTM', 5, 5000),
  ('UREA CONTOH',   'DEP', 999, 7200),  ('TALI 01',       'UTM', 0, 0);
