// The iPOS 5 "Laporan Penjualan" form: filters on the left (Periode, No Transaksi, Pelanggan,
// Gudang, User, Modul), the list of report types on the right, and Preview / Print / Excel.
// Preview opens the paginated paper view; Print opens it and goes straight to the Windows print
// dialog. iPOS's report designer buttons (Disain / Buat Baru / Hapus) have no counterpart.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, FileSpreadsheet, Loader2, Printer } from 'lucide-react';
import { useId, useState } from 'react';
import {
  SALES_PRINT_TITLES,
  SALES_PRINT_TYPES,
  type ReportFilterOptions,
  type ReportPeriod,
  type SalesPrintReport,
  type SalesPrintType,
} from '@shared/schemas/reports';
import { Notice } from '@/components/shared/Notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { todayJakarta, useCustomerSearch } from '@/features/pos/api';
import { useDebouncedValue } from '@/lib/hooks';
import { apiGet, toQuery } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { downloadReportXlsx } from './api';
import { periodSlug } from './period';
import { ReportPreview } from './print/ReportPreview';
import { salesPrintLayout } from './print/sales-layouts';

const ALL = 'all';
const MODULES = [
  { value: ALL, label: 'Semua' },
  { value: 'FAKTUR', label: 'Penjualan (faktur JL)' },
  { value: 'KASIR', label: 'Kasir (KSR)' },
] as const;

interface SalesPrintDialogProps {
  /** Starting values from the report page. */
  period: ReportPeriod;
  channel?: 'KASIR' | 'FAKTUR';
  /** Cashier: only own sales of today — no period, user or warehouse choice. */
  ownOnly: boolean;
  onClose: () => void;
}

interface Filters {
  from: string;
  to: string;
  numberFrom: string;
  numberTo: string;
  customerFrom: string;
  customerTo: string;
  warehouseId: string;
  userId: string;
  channel: string;
}

export function SalesPrintDialog({ period, channel, ownOnly, onClose }: SalesPrintDialogProps) {
  const qc = useQueryClient();
  const today = todayJakarta();
  const [type, setType] = useState<SalesPrintType>('rekap');
  const [f, setF] = useState<Filters>({
    from: ownOnly ? today : period.from,
    to: ownOnly ? today : period.to,
    numberFrom: '',
    numberTo: '',
    customerFrom: '',
    customerTo: '',
    warehouseId: ALL,
    userId: ALL,
    channel: channel ?? ALL,
  });
  const [busy, setBusy] = useState<'preview' | 'print' | 'xlsx' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ data: SalesPrintReport; autoPrint: boolean } | null>(null);
  const options = useQuery({
    queryKey: ['reports', 'filter-options'],
    queryFn: () => apiGet<ReportFilterOptions>('/reports/filter-options'),
    enabled: !ownOnly,
    staleTime: 60_000,
  });

  const set = (patch: Partial<Filters>) => setF((v) => ({ ...v, ...patch }));
  const params = {
    type,
    from: f.from,
    to: f.to,
    numberFrom: f.numberFrom.trim() || undefined,
    numberTo: f.numberTo.trim() || undefined,
    customerFrom: f.customerFrom.trim() || undefined,
    customerTo: f.customerTo.trim() || undefined,
    warehouseId: f.warehouseId === ALL ? undefined : f.warehouseId,
    userId: f.userId === ALL ? undefined : f.userId,
    channel: f.channel === ALL ? undefined : f.channel,
  };
  const stem = `${SALES_PRINT_TITLES[type].toLowerCase().replace(/\s+/g, '-')}-${periodSlug({ from: f.from, to: f.to })}`;
  const badPeriod = !f.from || !f.to || f.from > f.to;

  async function open(autoPrint: boolean) {
    setBusy(autoPrint ? 'print' : 'preview');
    setError(null);
    try {
      const data = await qc.fetchQuery({
        queryKey: ['reports', '/reports/sales/print', params],
        queryFn: () => apiGet<SalesPrintReport>(`/reports/sales/print${toQuery(params)}`),
        staleTime: 0,
      });
      setPreview({ data, autoPrint });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Laporan gagal dimuat.');
    } finally {
      setBusy(null);
    }
  }

  async function excel() {
    setBusy('xlsx');
    setError(null);
    try {
      await downloadReportXlsx('/reports/sales/print', params, stem);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'File Excel gagal dibuat.');
    } finally {
      setBusy(null);
    }
  }

  if (preview) {
    return (
      <ReportPreview
        report={salesPrintLayout(preview.data)}
        title={preview.data.title}
        fileName={stem}
        autoPrint={preview.autoPrint}
        onExcel={() => downloadReportXlsx('/reports/sales/print', params, stem)}
        onClose={() => setPreview(null)}
      />
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Cetak Laporan Penjualan</DialogTitle>
          <DialogDescription className="text-base">
            {ownOnly
              ? 'Penjualan Anda hari ini, dengan format laporan iPOS.'
              : 'Pilih saringan dan jenis laporan, lalu lihat pratinjau atau langsung cetak — format sama dengan iPOS.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[1fr_minmax(16rem,22rem)]">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!badPeriod) void open(false);
            }}
          >
            <RangeRow label="Periode">
              <Input
                type="date"
                aria-label="Dari tanggal"
                className="h-11"
                value={f.from}
                max={f.to || today}
                disabled={ownOnly}
                onChange={(e) => set({ from: e.target.value })}
              />
              <Input
                type="date"
                aria-label="Sampai tanggal"
                className="h-11"
                value={f.to}
                min={f.from}
                max={today}
                disabled={ownOnly}
                onChange={(e) => set({ to: e.target.value })}
              />
            </RangeRow>
            <RangeRow label="No Transaksi">
              <Input
                aria-label="No transaksi dari"
                className="h-11"
                placeholder="mis. 0000001/JL/UTM/0426"
                value={f.numberFrom}
                onChange={(e) => set({ numberFrom: e.target.value })}
              />
              <Input
                aria-label="No transaksi sampai"
                className="h-11"
                value={f.numberTo}
                onChange={(e) => set({ numberTo: e.target.value })}
              />
            </RangeRow>
            <RangeRow label="Pelanggan">
              <CustomerCodeInput
                label="Kode pelanggan dari"
                value={f.customerFrom}
                onChange={(v) => set({ customerFrom: v })}
              />
              <CustomerCodeInput
                label="Kode pelanggan sampai"
                value={f.customerTo}
                onChange={(v) => set({ customerTo: v })}
              />
            </RangeRow>
            {!ownOnly && (
              <>
                <FieldRow label="Gudang">
                  <Select value={f.warehouseId} onValueChange={(v) => set({ warehouseId: v })}>
                    <SelectTrigger className="h-11 w-full text-base" aria-label="Gudang">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL} className="text-base">
                        Semua
                      </SelectItem>
                      {options.data?.warehouses.map((w) => (
                        <SelectItem key={w.id} value={w.id} className="text-base">
                          {w.code} — {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldRow>
                <FieldRow label="User">
                  <Select value={f.userId} onValueChange={(v) => set({ userId: v })}>
                    <SelectTrigger className="h-11 w-full text-base" aria-label="User">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL} className="text-base">
                        Semua
                      </SelectItem>
                      {options.data?.users.map((u) => (
                        <SelectItem key={u.id} value={u.id} className="text-base">
                          {u.username.toUpperCase()} — {u.fullName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldRow>
              </>
            )}
            <FieldRow label="Modul">
              <Select value={f.channel} onValueChange={(v) => set({ channel: v })}>
                <SelectTrigger className="h-11 w-full text-base" aria-label="Modul">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODULES.map((m) => (
                    <SelectItem key={m.value} value={m.value} className="text-base">
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
            {/* Enter in any field = Pratinjau */}
            <button type="submit" hidden aria-hidden />
          </form>

          <div className="space-y-3">
            <p className="text-sm font-semibold">Jenis laporan</p>
            <div role="radiogroup" aria-label="Jenis laporan" className="overflow-hidden rounded-lg border">
              {SALES_PRINT_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={t === type}
                  onClick={() => setType(t)}
                  onDoubleClick={() => void open(false)}
                  className={cn(
                    'flex min-h-11 w-full items-center border-b px-3 text-left text-base last:border-b-0',
                    t === type ? 'bg-primary text-primary-foreground' : 'hover:bg-surface-muted',
                  )}
                >
                  {SALES_PRINT_TITLES[t]}
                </button>
              ))}
            </div>
            <p className="text-muted-foreground text-sm">
              Laporan per sales dan per gudang tidak tersedia: toko tidak memakai data sales dan hanya punya satu
              gudang.
            </p>
          </div>
        </div>

        {badPeriod && (
          <Notice tone="warning">Isi periode dengan benar: tanggal awal tidak boleh sesudah tanggal akhir.</Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}

        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button variant="ghost" className="h-11" onClick={onClose}>
            Tutup
          </Button>
          <Button variant="outline" className="h-11" onClick={() => void excel()} disabled={busy !== null || badPeriod}>
            {busy === 'xlsx' ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} Excel
          </Button>
          <Button
            variant="outline"
            className="h-11"
            onClick={() => void open(true)}
            disabled={busy !== null || badPeriod}
          >
            {busy === 'print' ? <Loader2 className="animate-spin" /> : <Printer />} Cetak
          </Button>
          <Button className="h-11" onClick={() => void open(false)} disabled={busy !== null || badPeriod}>
            {busy === 'preview' ? <Loader2 className="animate-spin" /> : <Eye />} Pratinjau
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-center gap-3">
      <span className="text-muted-foreground text-right text-sm">{label}</span>
      {children}
    </div>
  );
}

function RangeRow({ label, children }: { label: string; children: [React.ReactNode, React.ReactNode] }) {
  return (
    <FieldRow label={label}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        {children[0]}
        <span className="text-muted-foreground text-sm">s/d</span>
        {children[1]}
      </div>
    </FieldRow>
  );
}

/** Customer code with suggestions from the customer list (code — name). */
function CustomerCodeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const listId = useId();
  const q = useDebouncedValue(value.trim(), 250);
  const found = useCustomerSearch(q, q.length >= 2);
  return (
    <>
      <Input
        aria-label={label}
        className="h-11"
        placeholder="Kode"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {found.data?.data.map((c) => (
          <option key={c.id} value={c.code}>
            {c.name}
          </option>
        ))}
      </datalist>
    </>
  );
}
