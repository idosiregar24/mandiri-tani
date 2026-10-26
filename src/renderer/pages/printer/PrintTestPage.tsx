// Sprint 0 inside the app: print test pages through the real print path for BOTH store
// printers — faktur on the Epson LX-310 (ESC/P) and struk on the thermal printer (ESC/POS).
// Simple by design (design-standards §0).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Loader2,
  Printer,
  Receipt,
  RefreshCw,
  Save,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  FAKTUR_TEST_PAGES,
  pickPrinter,
  STRUK_TEST_PAGES,
  TEST_PAGE_LABELS,
  type PrinterInfo,
  type PrinterRole,
  type PrinterSettings,
  type PrintResult,
  type PrintTestRequest,
  type TestPage,
} from '@shared/printing';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { desktopBridge } from '@/lib/desktop';
import { cn } from '@/lib/utils';

const ROLE_TABS: { role: PrinterRole; title: string; subtitle: string; icon: typeof FileText }[] = [
  { role: 'faktur', title: 'Printer Faktur', subtitle: 'Epson LX-310 · kertas ½ halaman', icon: FileText },
  { role: 'struk', title: 'Printer Struk Kasir', subtitle: 'Thermal · kertas gulung', icon: Receipt },
];

export function PrintTestPage() {
  const bridge = desktopBridge();
  const [role, setRole] = useState<PrinterRole>('faktur');
  const queryClient = useQueryClient();
  const printers = useQuery({
    queryKey: ['printers'],
    queryFn: () => bridge!.listPrinters(),
    enabled: Boolean(bridge),
  });
  const settings = useQuery({
    queryKey: ['printerSettings'],
    queryFn: () => bridge!.getPrinterSettings(),
    enabled: Boolean(bridge),
    staleTime: Infinity,
  });

  if (!bridge) {
    return (
      <div className="max-w-3xl">
        <p className="text-lg">Uji cetak hanya tersedia di aplikasi desktop.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <Link to="/" className="text-muted-foreground inline-flex items-center gap-2 text-base hover:underline">
        <ArrowLeft className="size-5" /> Kembali
      </Link>
      <h1 className="text-tani-green-dark mt-4 text-3xl font-bold">Uji Cetak Printer</h1>

      <div className="mt-6 grid grid-cols-2 gap-3" role="tablist">
        {ROLE_TABS.map((tab) => (
          <button
            key={tab.role}
            role="tab"
            aria-selected={role === tab.role}
            onClick={() => setRole(tab.role)}
            className={cn(
              'flex items-center gap-3 rounded-xl border-2 bg-white p-4 text-left transition-colors',
              role === tab.role ? 'border-primary bg-tani-green-light' : 'border-border hover:border-primary/50',
            )}
          >
            <tab.icon className="text-tani-green-dark size-8 shrink-0" />
            <span>
              <span className="block text-lg font-semibold">{tab.title}</span>
              <span className="text-muted-foreground block text-base">{tab.subtitle}</span>
            </span>
          </button>
        ))}
      </div>

      {settings.isPending && (
        <p className="text-muted-foreground mt-6 flex items-center gap-2 text-lg">
          <Loader2 className="size-5 animate-spin" /> Memuat pengaturan printer…
        </p>
      )}
      {settings.isError && <Warning tone="error">Pengaturan printer gagal dimuat: {settings.error.message}</Warning>}

      {/* Both stay mounted (only hidden) so unsaved edits survive switching tabs. */}
      {settings.data &&
        ROLE_TABS.map((tab) => (
          <div key={tab.role} hidden={role !== tab.role}>
            <RoleSection
              role={tab.role}
              saved={settings.data}
              printers={printers.data ?? []}
              loading={printers.isLoading}
              loaded={printers.isSuccess}
              onRefresh={() => void printers.refetch()}
              print={(request) => bridge.printTest(request)}
              save={async (next) =>
                queryClient.setQueryData(['printerSettings'], await bridge.savePrinterSettings(next))
              }
            />
          </div>
        ))}
    </div>
  );
}

function RoleSection({
  role,
  saved,
  printers,
  loading,
  loaded,
  onRefresh,
  print,
  save,
}: {
  role: PrinterRole;
  saved: PrinterSettings;
  printers: PrinterInfo[];
  loading: boolean;
  loaded: boolean;
  onRefresh: () => void;
  print: (request: PrintTestRequest) => Promise<PrintResult>;
  save: (next: PrinterSettings) => Promise<unknown>;
}) {
  const [printer, setPrinter] = useState(saved[role].printer ?? '');
  const [userPicked, setUserPicked] = useState(false);
  const [linesPerPage, setLinesPerPage] = useState(saved.faktur.linesPerPage);
  const [nlq, setNlq] = useState(saved.faktur.nlq);
  const [columns, setColumns] = useState(saved.struk.columns);
  const [cut, setCut] = useState(saved.struk.cut);
  const [last, setLast] = useState<{ page: TestPage; result: PrintResult } | null>(null);

  // A saved queue is used only while it is ready — never a remembered dead port (LPT1).
  const chosen = printers.find((p) => p.name === printer);
  const selected = (chosen && (userPicked || chosen.ready) ? chosen.name : pickPrinter(printers, role)?.name) ?? '';
  const selectedInfo = printers.find((p) => p.name === selected);

  // Only this role is written; the other printer's saved settings stay as they are.
  const next: PrinterSettings =
    role === 'faktur'
      ? { ...saved, faktur: { printer: selected || null, linesPerPage, nlq } }
      : { ...saved, struk: { printer: selected || null, columns, cut } };
  const dirty = JSON.stringify(next[role]) !== JSON.stringify(saved[role]);
  const saveMutation = useMutation({ mutationFn: () => save(next) });

  const mutation = useMutation({
    mutationFn: (page: TestPage) =>
      print(
        role === 'faktur'
          ? { role, printer: selected, page: page as (typeof FAKTUR_TEST_PAGES)[number], linesPerPage, nlq }
          : { role, printer: selected, page: page as (typeof STRUK_TEST_PAGES)[number], columns, cut },
      ),
    onSuccess: (result, page) => setLast({ page, result }),
  });

  const pages: readonly TestPage[] = role === 'faktur' ? FAKTUR_TEST_PAGES : STRUK_TEST_PAGES;
  const detected = role === 'faktur' ? printers.some((p) => p.isLx310) : printers.some((p) => p.isReceipt);
  const settingsValid =
    role === 'faktur' ? Number.isInteger(linesPerPage) && linesPerPage >= 10 && linesPerPage <= 99 : true;
  const inputClass = 'border-input h-12 rounded-md border bg-white px-3 text-lg';

  return (
    <>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-xl">1. Pilih printer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-3">
            <select
              aria-label="Printer"
              className={cn(inputClass, 'flex-1')}
              value={selected}
              onChange={(e) => {
                setPrinter(e.target.value);
                setUserPicked(true);
              }}
              disabled={loading}
            >
              {loading && <option>Memuat daftar printer…</option>}
              {printers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName}
                  {p.port ? ` — ${p.port.replace(/:$/, '')}` : ''}
                  {p.ready ? '' : ` (tidak siap: ${p.status || 'tidak diketahui'})`}
                </option>
              ))}
            </select>
            <Button variant="outline" size="lg" className="h-12 text-base" onClick={onRefresh}>
              <RefreshCw /> Muat ulang
            </Button>
          </div>
          {selectedInfo && !selectedInfo.ready && (
            <Warning tone="error">
              Printer ini <b>tidak siap</b> (status {selectedInfo.status || 'tidak diketahui'}
              {selectedInfo.port ? `, port ${selectedInfo.port.replace(/:$/, '')}` : ''}). Pekerjaan cetak akan
              tertahan. Pilih printer yang port-nya <b>USB</b>.
            </Warning>
          )}
          {loaded && !detected && (
            <Warning tone="warning">
              {role === 'faktur' ? (
                <>
                  Epson LX-310 belum terdeteksi. Sambungkan kabel USB, nyalakan printer, pasang driver
                  <span className="font-mono"> LX-310_Drv_Ver1_1497909</span>, lalu tekan <b>Muat ulang</b>.
                </>
              ) : (
                <>
                  Printer struk belum terdeteksi otomatis. Sambungkan & nyalakan printer struk, pasang driver dari
                  pabriknya, lalu tekan <b>Muat ulang</b> — atau pilih nama printernya sendiri di daftar.
                </>
              )}
            </Warning>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-xl">2. Pengaturan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-lg">
          {role === 'faktur' ? (
            <>
              <label className="flex items-center gap-4">
                <span className="w-48">Baris per halaman</span>
                <input
                  type="number"
                  min={10}
                  max={99}
                  className={cn(inputClass, 'w-28')}
                  value={linesPerPage}
                  onChange={(e) => setLinesPerPage(Number(e.target.value))}
                />
                <span className="text-muted-foreground text-base">½ halaman = 33</span>
              </label>
              <label className="flex items-center gap-4">
                <input
                  type="checkbox"
                  className="size-6 accent-[var(--color-tani-green)]"
                  checked={nlq}
                  onChange={(e) => setNlq(e.target.checked)}
                />
                <span>Mode rapi (NLQ) — huruf lebih halus, cetak lebih lambat</span>
              </label>
            </>
          ) : (
            <>
              <label className="flex items-center gap-4">
                <span className="w-48">Lebar kertas</span>
                <select
                  className={cn(inputClass, 'w-64')}
                  value={columns}
                  onChange={(e) => setColumns(Number(e.target.value))}
                >
                  <option value={32}>58 mm — 32 huruf</option>
                  <option value={42}>58/80 mm kecil — 42 huruf</option>
                  <option value={48}>80 mm — 48 huruf</option>
                </select>
              </label>
              <label className="flex items-center gap-4">
                <input
                  type="checkbox"
                  className="size-6 accent-[var(--color-tani-green)]"
                  checked={cut}
                  onChange={(e) => setCut(e.target.checked)}
                />
                <span>Potong kertas otomatis setelah cetak (bila printer punya pemotong)</span>
              </label>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-xl">3. Cetak</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            {pages.map((page) => (
              <Button
                key={page}
                size="lg"
                variant={page === 'semua' || page === 'struk-contoh' ? 'default' : 'outline'}
                className="h-14 text-lg"
                disabled={!selected || !settingsValid || mutation.isPending}
                onClick={() => mutation.mutate(page)}
              >
                {mutation.isPending && mutation.variables === page ? <Loader2 className="animate-spin" /> : <Printer />}
                {TEST_PAGE_LABELS[page]}
              </Button>
            ))}
          </div>
          {last && <ResultBox page={last.page} result={last.result} />}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-xl">4. Yang perlu dicek di kertas</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-2 pl-6 text-lg">
            <li>Tercetak tanpa jendela dialog dan tanpa huruf aneh di awal.</li>
            {role === 'faktur' ? (
              <>
                <li>Pola: angka kolom terakhir (96) masih utuh di kanan.</li>
                <li>
                  Pola: baris {linesPerPage} tepat di atas perforasi; halaman berikut mulai tepat setelah perforasi.
                  Bila meleset, ubah "Baris per halaman" lalu cetak pola lagi.
                </li>
                <li>Setelah beberapa halaman, posisi kertas tidak makin turun/naik.</li>
                <li>Font: pilih yang paling mudah dibaca (Draft / NLQ Roman / NLQ Sans).</li>
                <li>
                  Faktur: kolom sejajar, angka rata kanan, "TOTAL AKHIR" tebal, muat ½ halaman, mirip faktur iPOS.
                </li>
              </>
            ) : (
              <>
                <li>
                  Pola lebar: tanda <b>|32</b>, <b>|42</b>, <b>|48</b> — mana yang terakhir masih tercetak utuh dalam
                  satu baris? Itulah lebar struk; pilih di "Lebar kertas".
                </li>
                <li>
                  Contoh struk: "MANDIRI TANI" besar di tengah, kolom harga & jumlah rata kanan, tidak ada baris yang
                  terpotong ke bawah.
                </li>
                <li>
                  Kertas maju cukup jauh lalu terpotong (bila ada pemotong) — struk bisa disobek tanpa memotong tulisan.
                </li>
                <li>Mirip struk KSR dari iPOS.</li>
              </>
            )}
          </ol>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-xl">5. Simpan pengaturan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-lg">
          <p className="text-muted-foreground text-base">
            Bila hasil cetak sudah benar, simpan. Pengaturan ini disimpan di komputer ini dan dipakai untuk
            {role === 'faktur' ? ' mencetak semua faktur penjualan.' : ' mencetak semua struk kasir.'}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Button
              size="lg"
              className="h-14 text-lg"
              disabled={!selected || !settingsValid || !dirty || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              Simpan pengaturan {role === 'faktur' ? 'printer faktur' : 'printer struk'}
            </Button>
            {loaded &&
              (dirty ? (
                <span className="text-warning-ink font-medium">Belum disimpan</span>
              ) : (
                <span className="text-success-ink flex items-center gap-2 font-medium">
                  <CheckCircle2 className="size-5" /> Tersimpan
                </span>
              ))}
          </div>
          {saveMutation.isError && <Warning tone="error">Gagal menyimpan: {saveMutation.error.message}</Warning>}
          {saved[role].printer && (
            <p className="text-base">
              Tersimpan: <b>{saved[role].printer}</b>
              {role === 'faktur'
                ? ` · ${saved.faktur.linesPerPage} baris/halaman · ${saved.faktur.nlq ? 'NLQ' : 'Draft'}`
                : ` · ${saved.struk.columns} huruf · ${saved.struk.cut ? 'potong otomatis' : 'tanpa potong'}`}
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Warning({ tone, children }: { tone: 'warning' | 'error'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex gap-3 rounded-lg border p-4 text-base',
        tone === 'error' ? 'border-error bg-error/10' : 'border-warning bg-warning/10',
      )}
    >
      <AlertTriangle className={cn('size-6 shrink-0', tone === 'error' ? 'text-error-ink' : 'text-warning-ink')} />
      <p>{children}</p>
    </div>
  );
}

function ResultBox({ page, result }: { page: TestPage; result: PrintResult }) {
  return (
    <div className="mt-5" role="status" aria-live="polite">
      {result.ok ? (
        <div className="border-success bg-success/10 flex gap-3 rounded-lg border p-4 text-lg">
          <CheckCircle2 className="text-success-ink size-6 shrink-0" />
          <p>
            <b>{TEST_PAGE_LABELS[page]}</b> terkirim ke printer ({(result.ms / 1000).toFixed(1)} dtk). Periksa hasil
            cetaknya dengan daftar di bawah.
          </p>
        </div>
      ) : (
        <div className="border-error bg-error/10 rounded-lg border p-4 text-lg">
          <div className="flex gap-3">
            <AlertTriangle className="text-error-ink size-6 shrink-0" />
            <p className="text-error-ink font-medium">{result.message}</p>
          </div>
          {result.detail && (
            <details className="text-muted-foreground mt-3 text-sm">
              <summary className="cursor-pointer">Detail teknis</summary>
              <pre className="mt-2 whitespace-pre-wrap">{result.detail}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
