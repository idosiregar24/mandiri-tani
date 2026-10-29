// "Impor iPOS" (Sprint 3 E8 + Sprint 4 C5 + Sprint 9 B4, FR-MIG-01…05/08): 1) pilih file → 2) pratinjau &
// masalah data → 3) impor master (+ rekonsiliasi) → 4) impor stok awal (+ rekonsiliasi) → 5) piutang terbuka
// & hutang yang dicentang (+ rekonsiliasi) → Selesai.
// Reset data persiapan at the bottom. Owner only.
import { CheckCircle2, FolderOpen, Loader2, PackageCheck, RotateCcw, Upload, Wallet, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  IMPORT_PURPOSES,
  type DataIssue,
  type ImportBatch,
  type ImportPurpose,
  type IposArApInspectResult,
  type IposInspectResult,
  type IposStockInspectResult,
  type ReconciliationRow,
} from '@shared/schemas/imports';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { Notice } from '@/components/shared/Notice';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  useCommitArAp,
  useCommitIpos,
  useCommitStock,
  useImportBatches,
  useInspectArAp,
  useInspectIpos,
  useInspectStock,
  useResetPreparation,
} from '@/features/imports/api';
import { desktopBridge } from '@/lib/desktop';
import { formatDateTime, formatNumber, formatRupiah } from '@/lib/format';
import { useCan } from '@/lib/session';
import { cn } from '@/lib/utils';

const PURPOSE_LABELS: Record<ImportPurpose, string> = {
  DEVELOPMENT: 'Uji coba (pengembangan)',
  REHEARSAL: 'Gladi sebelum go-live',
  GO_LIVE: 'Go-live (data resmi)',
};
const STATUS_LABELS: Record<ImportBatch['status'], string> = {
  RUNNING: 'Berjalan',
  COMMITTED: 'Berhasil',
  FAILED: 'Gagal',
  DISCARDED: 'Sudah direset',
};
const COUNT_LABELS: [keyof NonNullable<IposInspectResult['counts']>, string][] = [
  ['products', 'Barang'],
  ['multiUnitProducts', 'Barang dengan lebih dari satu satuan'],
  ['derivedUnits', 'Satuan turunan (mis. ZAK = 50 KG)'],
  ['pricedUnits', 'Harga jual per satuan'],
  ['categories', 'Kategori'],
  ['units', 'Satuan'],
  ['customerGroups', 'Grup pelanggan'],
  ['customers', 'Pelanggan'],
  ['suppliers', 'Supplier'],
  ['bankAccounts', 'Rekening bank'],
];

export function IposImportPage() {
  const bridge = desktopBridge();
  const canImport = useCan('imports.ipos');
  const canReset = useCan('system.reset_preparation');
  const inspect = useInspectIpos();
  const inspectStock = useInspectStock();
  const commit = useCommitIpos();
  const commitStock = useCommitStock();
  const inspectArAp = useInspectArAp();
  const commitArAp = useCommitArAp();
  const batches = useImportBatches();
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<{ message: string; detail?: string } | null>(null);
  const [purpose, setPurpose] = useState<ImportPurpose>('DEVELOPMENT');
  const [masterResult, setMasterResult] = useState<ImportBatch | null>(null);
  const [stockResult, setStockResult] = useState<ImportBatch | null>(null);
  const [arApResult, setArApResult] = useState<ImportBatch | null>(null);

  if (!canImport) return <Notice tone="warning">Hanya Owner yang boleh mengimpor data dari iPOS.</Notice>;

  const resetAll = () => {
    setPickError(null);
    setMasterResult(null);
    setStockResult(null);
    setArApResult(null);
    commit.reset();
    commitStock.reset();
    commitArAp.reset();
    inspect.reset();
    inspectStock.reset();
    inspectArAp.reset();
  };

  const choose = async () => {
    if (!bridge) return;
    resetAll();
    setPicking(true);
    try {
      const r = await bridge.chooseIposBackup();
      if (r.status === 'FAILED') setPickError({ message: r.message, detail: r.detail });
      if (r.status === 'RESTORED') {
        inspect.mutate();
        inspectStock.mutate();
        inspectArAp.mutate();
      }
    } finally {
      setPicking(false);
    }
  };

  const runImport = () =>
    commit.mutate(
      { purpose },
      {
        onSuccess: (batch) => {
          setMasterResult(batch);
          inspect.reset();
          // Stock and receivables are the next scopes from the same file: refresh their previews.
          inspectStock.mutate();
          inspectArAp.mutate();
        },
      },
    );

  const runStockImport = () =>
    commitStock.mutate(
      { purpose },
      {
        onSuccess: (batch) => {
          setStockResult(batch);
          inspectStock.reset();
        },
      },
    );

  const runArApImport = (payables: { legacyKey: string; amount: string }[]) =>
    commitArAp.mutate(
      { purpose, payables },
      {
        onSuccess: (batch) => {
          setArApResult(batch);
          inspectArAp.reset();
          // Last scope done — the temporary iPOS copy is no longer needed (FR-MIG-01).
          void bridge?.cleanupIposImport();
        },
      },
    );

  const finish = () => {
    void bridge?.cleanupIposImport();
    resetAll();
  };

  const preview = inspect.data;
  const stockPreview = inspectStock.data;
  const arApPreview = inspectArAp.data;
  const fileOpen = Boolean(preview || stockPreview || arApPreview || masterResult);
  const done = scopesDone(batches.data ?? []);
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Impor dari iPOS"
        description="Pindahkan data master (barang, harga, pelanggan, supplier, rekening), stok awal, lalu piutang & hutang dari backup iPOS 5."
      />

      {!bridge && <Notice tone="warning">Impor hanya bisa dijalankan dari aplikasi di komputer toko.</Notice>}

      <ScopeStatus done={done} />
      {done.master && !done.stock && !stockPreview && !stockResult && (
        <Notice tone="warning" title="Stok awal belum diimpor — semua stok di aplikasi masih 0.">
          Klik <strong>Pilih File Backup</strong>, pilih file backup iPOS yang sama, lalu jalankan langkah 4{' '}
          <strong>Impor Stok Awal</strong>. Data master tidak diimpor ulang.
        </Notice>
      )}

      <Step n={1} title="Pilih file backup iPOS" done={fileOpen || Boolean(arApResult)}>
        <p className="text-muted-foreground text-base">
          Buka iPOS → Backup Database, lalu pilih file <span className="font-mono">.i5bu</span> hasilnya. File hanya
          dibaca, tidak diubah dan tidak dikirim ke mana pun.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button
            size="lg"
            className="h-12 text-base"
            onClick={() => void choose()}
            disabled={
              !bridge ||
              picking ||
              inspect.isPending ||
              commit.isPending ||
              commitStock.isPending ||
              commitArAp.isPending
            }
          >
            {picking || inspect.isPending ? <Loader2 className="animate-spin" /> : <FolderOpen />}
            {picking ? 'Membuka backup…' : inspect.isPending ? 'Memeriksa isi backup…' : 'Pilih File Backup'}
          </Button>
          {fileOpen && !arApResult && (
            <Button variant="outline" size="lg" className="h-12 text-base" onClick={finish}>
              Selesai &amp; tutup file
            </Button>
          )}
        </div>
        {pickError && (
          <Notice tone="error" title={pickError.message} className="mt-3">
            {pickError.detail && <pre className="mt-2 text-sm whitespace-pre-wrap">{pickError.detail}</pre>}
          </Notice>
        )}
        {inspect.isError && (
          <Notice tone="error" className="mt-3">
            {inspect.error.message}
          </Notice>
        )}
      </Step>

      {preview && (
        <Preview
          preview={preview}
          purpose={purpose}
          onPurpose={setPurpose}
          onImport={runImport}
          importing={commit.isPending}
          masterDone={Boolean(done.master)}
        />
      )}
      {commit.isError && <Notice tone="error">{commit.error.message}</Notice>}
      {masterResult && <Reconciliation n={3} title="Data master masuk — cocokkan dengan iPOS" batch={masterResult} />}

      {stockPreview && (
        <StockStep
          preview={stockPreview}
          purpose={purpose}
          onImport={runStockImport}
          importing={commitStock.isPending}
        />
      )}
      {commitStock.isError && <Notice tone="error">{commitStock.error.message}</Notice>}
      {stockResult && <Reconciliation n={4} title="Stok awal masuk — cocokkan dengan iPOS" batch={stockResult} />}

      {arApPreview && (
        <ArApStep preview={arApPreview} purpose={purpose} onImport={runArApImport} importing={commitArAp.isPending} />
      )}
      {commitArAp.isError && <Notice tone="error">{commitArAp.error.message}</Notice>}
      {arApResult && <Reconciliation n={6} title="Piutang & hutang masuk — cocokkan dengan iPOS" batch={arApResult} />}

      <History batches={batches.data ?? []} />

      {canReset && <ResetCard />}
    </div>
  );
}

function Issues({ issues }: { issues: DataIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="mt-5 space-y-2">
      <h3 className="text-lg font-semibold">Catatan kualitas data</h3>
      <p className="text-muted-foreground text-base">Tidak menghalangi impor. Periksa setelah impor bila perlu.</p>
      {issues.map((i) => (
        <details key={i.code} className="rounded-lg border px-4 py-3">
          <summary className="cursor-pointer text-base">
            <span className="font-semibold">{i.title}</span> — {formatNumber(String(i.count))} data
            <span className="text-muted-foreground"> · {i.action}</span>
          </summary>
          {i.examples.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-base">
              {i.examples.map((e) => (
                <li key={e}>{e}</li>
              ))}
              {i.count > i.examples.length && (
                <li className="text-muted-foreground">dan {i.count - i.examples.length} lainnya</li>
              )}
            </ul>
          )}
        </details>
      ))}
    </div>
  );
}

function StockStep({
  preview,
  purpose,
  onImport,
  importing,
}: {
  preview: IposStockInspectResult;
  purpose: ImportPurpose;
  onImport: () => void;
  importing: boolean;
}) {
  const c = preview.counts;
  return (
    <Step n={4} title="Impor stok awal">
      <p className="text-muted-foreground text-base">
        Stok tiap barang beserta lapisan HPP FIFO-nya disalin dari iPOS, jadi nilai persediaan dan urutan HPP sama
        dengan iPOS.
      </p>
      {preview.fingerprint.length > 0 && (
        <Notice tone="error" title="Struktur tabel stok tidak cocok — impor stok dihentikan" className="mt-4">
          {preview.fingerprint
            .map((f) => `${f.table}${f.missingColumns.length ? ` (${f.missingColumns.join(', ')})` : ''}`)
            .join(' · ')}
        </Notice>
      )}
      {c && (
        <dl className="mt-4 grid gap-3 sm:grid-cols-4">
          {[
            ['Barang berstok', formatNumber(String(c.products))],
            ['Lapisan HPP', formatNumber(String(c.layers))],
            ['Nilai persediaan', formatRupiah(c.value)],
            ['Stok minus', formatNumber(String(c.minusProducts))],
          ].map(([label, value]) => (
            <div key={label} className="bg-surface-muted rounded-lg border p-3">
              <dt className="text-muted-foreground text-sm">{label}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <Issues issues={preview.issues} />
      <div className="mt-5">
        {preview.blocker ? (
          <Notice tone="warning">{preview.blocker}</Notice>
        ) : (
          <Button size="lg" className="h-12 text-base" onClick={onImport} disabled={importing}>
            {importing ? <Loader2 className="animate-spin" /> : <PackageCheck />} Impor Stok Awal (
            {PURPOSE_LABELS[purpose]})
          </Button>
        )}
      </div>
    </Step>
  );
}

/**
 * Step 5 (FR-MIG-05): every open iPOS credit note comes over by itself; supplier debts only for the
 * invoices the Owner ticks — iPOS never recorded a supplier payment, so many of them are long paid.
 */
function ArApStep({
  preview,
  purpose,
  onImport,
  importing,
}: {
  preview: IposArApInspectResult;
  purpose: ImportPurpose;
  onImport: (payables: { legacyKey: string; amount: string }[]) => void;
  importing: boolean;
}) {
  const [ticked, setTicked] = useState<Record<string, string>>({});
  const c = preview.counts;
  const date = (d: string) => d.split('-').reverse().join('/');
  const picked = Object.entries(ticked).map(([legacyKey, amount]) => ({ legacyKey, amount }));
  const valid = picked.every((p) => p.amount !== '' && p.amount !== '0');
  const toggle = (legacyKey: string, open: string) =>
    setTicked((t) => {
      const next = { ...t };
      if (legacyKey in next) delete next[legacyKey];
      else next[legacyKey] = open.replace(/\.00$/, '');
      return next;
    });
  return (
    <Step n={5} title="Impor piutang & hutang">
      <p className="text-muted-foreground text-base">
        Semua nota penjualan yang belum lunas di iPOS masuk sebagai piutang dengan nomor, tanggal, dan jatuh tempo
        aslinya. Hutang supplier: centang hanya faktur yang <strong>benar-benar belum dibayar</strong>.
      </p>
      {preview.fingerprint.length > 0 && (
        <Notice tone="error" title="Struktur tabel piutang/hutang tidak cocok — impor dihentikan" className="mt-4">
          {preview.fingerprint
            .map((f) => `${f.table}${f.missingColumns.length ? ` (${f.missingColumns.join(', ')})` : ''}`)
            .join(' · ')}
        </Notice>
      )}
      {c && (
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            ['Nota piutang terbuka', formatNumber(String(c.receivables))],
            ['Total sisa piutang', formatRupiah(c.receivablesOpen)],
            ['Pelanggan berpiutang', formatNumber(String(c.customers))],
          ].map(([label, value]) => (
            <div key={label} className="bg-surface-muted rounded-lg border p-3">
              <dt className="text-muted-foreground text-sm">{label}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <Issues issues={preview.issues} />
      {preview.payables.length > 0 && (
        <div className="mt-5 space-y-2">
          <h3 className="text-lg font-semibold">
            Faktur pembelian kredit di iPOS ({formatNumber(String(preview.payables.length))})
          </h3>
          <div className="max-h-[50vh] overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Belum lunas</TableHead>
                  <TableHead>Faktur</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Nilai di iPOS</TableHead>
                  <TableHead className="w-48 text-right">Sisa hutang</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.payables.map((p) => {
                  const on = p.legacyKey in ticked;
                  return (
                    <TableRow key={p.legacyKey} className={cn(on && 'bg-tani-green-light')}>
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Belum lunas ${p.legacyKey}`}
                          className="accent-primary size-5"
                          disabled={!p.supplierName}
                          checked={on}
                          onChange={() => toggle(p.legacyKey, p.open)}
                        />
                      </TableCell>
                      <TableCell>
                        <p className="font-mono">{p.legacyKey}</p>
                        <p className="text-muted-foreground text-sm">
                          {date(p.docDate)} · jatuh tempo {date(p.dueDate)}
                        </p>
                      </TableCell>
                      <TableCell>
                        {p.supplierName ?? <span className="text-error-ink">{p.supplierCode} (tidak ada)</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatRupiah(p.open)}</TableCell>
                      <TableCell>
                        {on && (
                          <MoneyInput
                            value={ticked[p.legacyKey]!}
                            onChange={(v) => setTicked((t) => ({ ...t, [p.legacyKey]: v }))}
                            className="h-10"
                            aria-label={`Sisa hutang ${p.legacyKey}`}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="text-muted-foreground text-sm">
            {formatNumber(String(picked.length))} faktur dicentang. Faktur lain dianggap sudah lunas. Hutang di luar
            iPOS bisa dicatat nanti di menu Hutang → Hutang manual.
          </p>
        </div>
      )}
      <div className="mt-5">
        {preview.blocker ? (
          <Notice tone="warning">{preview.blocker}</Notice>
        ) : (
          <Button size="lg" className="h-12 text-base" onClick={() => onImport(picked)} disabled={importing || !valid}>
            {importing ? <Loader2 className="animate-spin" /> : <Wallet />} Impor Piutang &amp; Hutang (
            {PURPOSE_LABELS[purpose]})
          </Button>
        )}
      </div>
    </Step>
  );
}

/** Which scopes are already in the app (latest COMMITTED batch per scope). */
function scopesDone(batches: ImportBatch[]): Record<'master' | 'stock' | 'receivables', ImportBatch | null> {
  const find = (scope: 'master' | 'stock' | 'receivables') =>
    batches.find((b) => b.status === 'COMMITTED' && b.scope.includes(scope)) ?? null;
  return { master: find('master'), stock: find('stock'), receivables: find('receivables') };
}

function ScopeStatus({ done }: { done: ReturnType<typeof scopesDone> }) {
  const rows = [
    { label: 'Data master', hint: 'barang, satuan, harga, pelanggan, supplier, rekening', batch: done.master },
    { label: 'Stok awal', hint: 'jumlah stok & lapisan HPP FIFO', batch: done.stock },
    { label: 'Piutang & hutang', hint: 'nota belum lunas & hutang supplier yang dicentang', batch: done.receivables },
  ];
  return (
    <section className="divide-y rounded-xl border">
      {rows.map((r) => (
        <div key={r.label} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-base">
          <div>
            <p className="font-medium">{r.label}</p>
            <p className="text-muted-foreground text-sm">{r.hint}</p>
          </div>
          {r.batch ? (
            <span className="text-success-ink flex items-center gap-2">
              <CheckCircle2 className="size-5" /> Sudah diimpor{' '}
              {formatDateTime(r.batch.finishedAt ?? r.batch.startedAt)}
            </span>
          ) : (
            <span className="text-warning-ink flex items-center gap-2">
              <XCircle className="size-5" /> Belum diimpor
            </span>
          )}
        </div>
      ))}
    </section>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-full text-base font-bold',
              done ? 'bg-primary text-primary-foreground' : 'bg-tani-green-light text-tani-green-dark',
            )}
          >
            {done ? <CheckCircle2 className="size-5" /> : n}
          </span>
          <CardTitle className="text-xl">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Preview({
  preview,
  purpose,
  onPurpose,
  onImport,
  importing,
  masterDone,
}: {
  preview: IposInspectResult;
  purpose: ImportPurpose;
  onPurpose: (p: ImportPurpose) => void;
  onImport: () => void;
  importing: boolean;
  masterDone: boolean;
}) {
  const s = preview.source;
  return (
    <>
      <Step n={2} title="Periksa isi backup">
        <dl className="grid grid-cols-[12rem_1fr] gap-x-4 gap-y-1 text-base">
          <dt className="text-muted-foreground">File</dt>
          <dd className="font-mono">{s.fileName}</dd>
          <dt className="text-muted-foreground">Dibuat iPOS</dt>
          <dd>{s.dumpCreatedAt ?? 'tidak diketahui'}</dd>
          <dt className="text-muted-foreground">Sidik file (SHA-256)</dt>
          <dd className="font-mono text-sm break-all">{s.sha256}</dd>
        </dl>

        {preview.fingerprint.length > 0 && (
          <Notice tone="error" title="Struktur backup tidak cocok — impor dihentikan" className="mt-4">
            <ul className="list-disc pl-5">
              {preview.fingerprint.map((f) => (
                <li key={f.table}>
                  <span className="font-mono">{f.table}</span>:{' '}
                  {f.missingColumns.length ? `kolom hilang ${f.missingColumns.join(', ')}` : 'tabel tidak ada'}
                </li>
              ))}
            </ul>
            <p className="mt-2">Kemungkinan backup dari versi iPOS lain. Hubungi pembuat aplikasi.</p>
          </Notice>
        )}

        {preview.counts && (
          <Table className="mt-4 text-base">
            <TableHeader>
              <TableRow className="bg-surface-muted hover:bg-surface-muted">
                <TableHead className="text-muted-foreground text-sm font-medium">Data</TableHead>
                <TableHead className="text-muted-foreground text-right text-sm font-medium">Jumlah di iPOS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {COUNT_LABELS.map(([key, label]) => (
                <TableRow key={key}>
                  <TableCell>{label}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(String(preview.counts![key]))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Issues issues={preview.issues} />
      </Step>

      <Step n={3} title="Impor data master" done={masterDone}>
        {masterDone ? (
          <Notice tone="success">Data master sudah diimpor. Lanjutkan ke langkah 4 di bawah untuk stok awal.</Notice>
        ) : preview.blocker ? (
          <Notice tone="warning">{preview.blocker}</Notice>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-base">
              <span className="block font-medium">Tujuan impor</span>
              <Select value={purpose} onValueChange={(v) => onPurpose(v as ImportPurpose)}>
                <SelectTrigger className="h-12 w-72 text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMPORT_PURPOSES.map((p) => (
                    <SelectItem key={p} value={p} className="text-base">
                      {PURPOSE_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <Button size="lg" className="h-12 text-base" onClick={onImport} disabled={importing}>
              {importing ? <Loader2 className="animate-spin" /> : <Upload />} Impor Data Master
            </Button>
          </div>
        )}
      </Step>
    </>
  );
}

function formatRow(r: ReconciliationRow, v: string): string {
  return r.kind === 'money' ? formatRupiah(v) : formatNumber(v);
}

function Reconciliation({ n, title, batch }: { n: number; title: string; batch: ImportBatch }) {
  const allMatch = batch.reconciliation.every((r) => r.ok);
  return (
    <Step n={n} title={title} done>
      <Notice
        tone={allMatch ? 'success' : 'warning'}
        title={
          allMatch ? 'Impor selesai — semua angka cocok dengan iPOS.' : 'Impor selesai, tetapi ada angka yang berbeda.'
        }
      >
        {!allMatch &&
          'Periksa baris yang ditandai merah dan catatan kualitas data. Bila salah, jalankan Reset data persiapan lalu impor ulang.'}
      </Notice>
      <Table className="mt-4 text-base">
        <TableHeader>
          <TableRow className="bg-surface-muted hover:bg-surface-muted">
            <TableHead className="text-muted-foreground text-sm font-medium">Data</TableHead>
            <TableHead className="text-muted-foreground text-right text-sm font-medium">iPOS</TableHead>
            <TableHead className="text-muted-foreground text-right text-sm font-medium">Hasil impor</TableHead>
            <TableHead className="w-16" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {batch.reconciliation.map((r) => (
            <TableRow key={r.label} className={cn(!r.ok && 'bg-error/10')}>
              <TableCell>{r.label}</TableCell>
              <TableCell className="text-right tabular-nums">{formatRow(r, r.ipos)}</TableCell>
              <TableCell className={cn('text-right tabular-nums', !r.ok && 'text-error-ink font-semibold')}>
                {formatRow(r, r.imported)}
              </TableCell>
              <TableCell>
                {r.ok ? (
                  <CheckCircle2 className="text-success-ink size-5" aria-label="cocok" />
                ) : (
                  <XCircle className="text-error-ink size-5" aria-label="berbeda" />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Step>
  );
}

function History({ batches }: { batches: ImportBatch[] }) {
  if (batches.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Riwayat impor</CardTitle>
      </CardHeader>
      <CardContent>
        <Table className="text-base">
          <TableHeader>
            <TableRow className="bg-surface-muted hover:bg-surface-muted">
              <TableHead className="text-muted-foreground text-sm font-medium">Waktu</TableHead>
              <TableHead className="text-muted-foreground text-sm font-medium">File</TableHead>
              <TableHead className="text-muted-foreground text-sm font-medium">Tujuan</TableHead>
              <TableHead className="text-muted-foreground text-sm font-medium">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.map((b) => (
              <TableRow key={b.id}>
                <TableCell>{formatDateTime(b.startedAt)}</TableCell>
                <TableCell className="font-mono text-sm">{b.sourceFile}</TableCell>
                <TableCell>{PURPOSE_LABELS[b.purpose]}</TableCell>
                <TableCell>
                  <Badge variant={b.status === 'COMMITTED' ? 'default' : 'outline'} className="text-sm">
                    {STATUS_LABELS[b.status]}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** FR-MIG-08 — dangerous, so: typed confirmation + a second dialog + an automatic backup on the server side. */
function ResetCard() {
  const reset = useResetPreparation();
  const [typed, setTyped] = useState('');
  const [confirming, setConfirming] = useState(false);
  const ready = typed.trim().toUpperCase() === 'RESET';
  return (
    <Card className="border-error/40">
      <CardHeader>
        <CardTitle className="text-error-ink text-xl">Reset data persiapan</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-base">
        <p>
          Menghapus semua barang, harga, pelanggan, supplier, rekening, dan riwayat impor, supaya bisa mengimpor ulang
          dari backup iPOS terbaru. Akun, perangkat, pengaturan printer, dan catatan audit <strong>tetap</strong>.
          Backup otomatis dibuat lebih dulu.
        </p>
        <p className="text-muted-foreground">Hanya bisa sebelum toko resmi go-live.</p>
        {reset.isSuccess && (
          <Notice tone="success" title="Data persiapan sudah direset.">
            Backup sebelum reset: <span className="font-mono">{reset.data.backupFile}</span>
          </Notice>
        )}
        {reset.isError && <Notice tone="error">{reset.error.message}</Notice>}
        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Ketik RESET"
            aria-label="Ketik RESET untuk konfirmasi"
            className="h-11 w-48 font-mono text-base md:text-base"
          />
          <Button
            variant="destructive"
            className="h-11 text-base"
            disabled={!ready || reset.isPending}
            onClick={() => setConfirming(true)}
          >
            <RotateCcw /> Reset Data
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        tone="danger"
        title="Hapus semua data persiapan?"
        description="Data master hasil impor dan yang diketik manual akan dihapus. Backup otomatis dibuat dulu dan bisa dipulihkan."
        confirmLabel="Ya, reset sekarang"
        pending={reset.isPending}
        onConfirm={() =>
          reset.mutate(
            { confirm: typed },
            {
              onSettled: () => {
                setConfirming(false);
                setTyped('');
              },
            },
          )
        }
      />
    </Card>
  );
}
