// Frame of every report page (sprint-10 E1): title, period choice, Cetak / Simpan PDF / Excel, and an
// A4 print view. "Cetak" uses the Windows print dialog — the documented exception for reports
// (FR-FIN-10); PDF goes through window.pos (desktop only); Excel is the same report from the server.
import { FileSpreadsheet, FileText, Loader2, Printer } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { ReportPeriod } from '@shared/schemas/reports';
import { Notice } from '@/components/shared/Notice';
import { PageHeader } from '@/components/shared/PageHeader';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { todayJakarta } from '@/features/pos/api';
import { desktopBridge } from '@/lib/desktop';
import { formatDateTime } from '@/lib/format';
import { downloadReportXlsx, type ReportParams } from './api';
import { matchQuick, periodSlug, periodText, QUICK_PERIODS, quickPeriod, type QuickPeriod } from './period';

interface ReportLayoutProps {
  title: string;
  description?: string;
  /** Omit for "as of today" reports (stock, goods not yet picked up). */
  period?: { value: ReportPeriod; onChange: (p: ReportPeriod) => void };
  /** Extra filters next to the period (channel, grouping…). */
  filters?: ReactNode;
  /** Server path of the report; Excel = the same path + ?format=xlsx. */
  exportPath: string;
  exportParams: ReportParams;
  /** File name stem, e.g. "laba-per-barang". The period is appended. */
  fileName: string;
  landscape?: boolean;
  children: ReactNode;
}

export function ReportLayout({
  title,
  description,
  period,
  filters,
  exportPath,
  exportParams,
  fileName,
  landscape = false,
  children,
}: ReportLayoutProps) {
  const bridge = desktopBridge();
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const stem = period ? `${fileName}-${periodSlug(period.value)}` : `${fileName}-${todayJakarta()}`;

  async function savePdf() {
    if (!bridge) return;
    setBusy('pdf');
    setMessage(null);
    try {
      const r = await bridge.saveReportPdf({ fileName: stem, landscape });
      if (r.status === 'SAVED') setMessage({ tone: 'success', text: `PDF tersimpan: ${r.fileName}` });
      if (r.status === 'FAILED') setMessage({ tone: 'error', text: r.message });
    } finally {
      setBusy(null);
    }
  }

  async function saveXlsx() {
    setBusy('xlsx');
    setMessage(null);
    try {
      await downloadReportXlsx(exportPath, exportParams, stem);
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'File Excel gagal dibuat.' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* The paper orientation of window.print() / printToPDF follows this page. */}
      <style>{`@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 10mm; }`}</style>

      <div className="hidden print:block">
        <p className="text-sm">Mandiri Tani</p>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm">
          {period ? periodText(period.value) : `Per ${periodText({ from: todayJakarta(), to: todayJakarta() })}`} ·
          dicetak {formatDateTime(new Date())}
        </p>
      </div>

      <PageHeader
        className="print:hidden"
        title={title}
        description={description}
        actions={
          <>
            <Button variant="outline" className="h-11" onClick={() => window.print()}>
              <Printer /> Cetak
            </Button>
            {bridge && (
              <Button variant="outline" className="h-11" onClick={() => void savePdf()} disabled={busy !== null}>
                {busy === 'pdf' ? <Loader2 className="animate-spin" /> : <FileText />} Simpan PDF
              </Button>
            )}
            <Button variant="outline" className="h-11" onClick={() => void saveXlsx()} disabled={busy !== null}>
              {busy === 'xlsx' ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} Excel
            </Button>
          </>
        }
      />

      {(period || filters) && (
        <div className="flex flex-wrap items-center gap-3 print:hidden">
          {period && <PeriodPicker value={period.value} onChange={period.onChange} />}
          {filters}
        </div>
      )}
      {message && (
        <Notice tone={message.tone} className="print:hidden">
          {message.text}
        </Notice>
      )}
      {children}
    </div>
  );
}

function PeriodPicker({ value, onChange }: { value: ReportPeriod; onChange: (p: ReportPeriod) => void }) {
  const today = todayJakarta();
  const [custom, setCustom] = useState(() => matchQuick(value, today) === 'custom');
  const quick: QuickPeriod = custom ? 'custom' : matchQuick(value, today);
  return (
    <>
      <SegmentedControl
        label="Periode"
        value={quick}
        options={QUICK_PERIODS}
        onChange={(v) => {
          setCustom(v === 'custom');
          if (v !== 'custom') onChange(quickPeriod(v, today));
        }}
      />
      {quick === 'custom' && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label="Dari tanggal"
            className="h-11 w-44"
            value={value.from}
            max={value.to}
            onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
          />
          <span className="text-muted-foreground">s/d</span>
          <Input
            type="date"
            aria-label="Sampai tanggal"
            className="h-11 w-44"
            value={value.to}
            min={value.from}
            max={today}
            onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
          />
        </div>
      )}
    </>
  );
}
