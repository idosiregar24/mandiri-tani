// "Preview" of a report like the iPOS 5 preview window: real paper pages (report header on page 1,
// column captions + "n/m" footer on every page), paper size & orientation, zoom, and the iPOS
// File menu actions — Cetak (Windows print dialog: printer, copies, pages), Simpan PDF and Excel.
// The pages are measured in the browser and split like DevExpress does, so what is shown is what
// prints. Printing happens through the print stylesheet (app.css, .mt-report-*): only the pages.
import { ChevronLeft, ChevronRight, FileSpreadsheet, FileText, Loader2, Minus, Plus, Printer, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Notice } from '@/components/shared/Notice';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { desktopBridge } from '@/lib/desktop';
import {
  PAGE_MARGIN_MM,
  PAPERS,
  pageSize,
  paginate,
  type Orientation,
  type PageSlice,
  type PaperKind,
  type PrintBand,
  type PrintReport,
  type PrintText,
} from './model';

const PX_PER_MM = 96 / 25.4;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const ORIENTATIONS = [
  { value: 'portrait', label: 'Tegak' },
  { value: 'landscape', label: 'Mendatar' },
] as const;

const mm = (v: number) => `${v}mm`;

function textStyle(t: PrintText, band: PrintBand): CSSProperties {
  return {
    width: mm(t.w),
    fontSize: `${t.size ?? band.size ?? 9}pt`,
    fontWeight: t.bold ? 700 : 400,
    fontStyle: t.italic ? 'italic' : 'normal',
    textDecoration: t.underline ? 'underline' : 'none',
    textAlign: t.align ?? 'left',
    padding: '0 0.5mm',
    whiteSpace: t.nowrap ? 'nowrap' : 'normal',
    overflowWrap: 'anywhere',
    lineHeight: 1.15,
    boxSizing: 'border-box',
  };
}

/** One band, drawn at its template positions. */
export function BandView({ band }: { band: PrintBand }) {
  const decorations = (
    <>
      {band.lines?.map((l, i) => (
        <div
          key={`l${i}`}
          style={{
            position: 'absolute',
            left: mm(l.x),
            top: mm(l.y - 0.15),
            width: mm(l.w),
            borderTop: `0.3mm ${l.dotted ? 'dotted' : 'solid'} #000`,
          }}
        />
      ))}
      {band.images?.map((img, i) => (
        <img
          key={`i${i}`}
          src={img.src}
          alt=""
          style={{
            position: 'absolute',
            left: mm(img.x),
            top: mm(img.y),
            width: mm(img.w),
            height: mm(img.h),
            objectFit: 'contain',
          }}
        />
      ))}
    </>
  );

  if (band.mode === 'fixed') {
    return (
      <div style={{ position: 'relative', height: mm(band.height) }}>
        {decorations}
        {band.texts.map((t, i) => {
          const justify = t.align === 'right' ? 'flex-end' : t.align === 'center' ? 'center' : 'flex-start';
          return (
            <div
              key={i}
              style={{
                ...textStyle(t, band),
                position: 'absolute',
                left: mm(t.x),
                top: mm(t.y ?? 0),
                height: t.h ? mm(t.h) : undefined,
                display: 'flex',
                alignItems: t.middle ? 'center' : 'flex-start',
                justifyContent: justify,
              }}
            >
              <span>{t.text}</span>
            </div>
          );
        })}
      </div>
    );
  }

  // flow: texts side by side from the left, sorted by x; the band grows with wrapped text
  const sorted = [...band.texts].sort((a, b) => a.x - b.x);
  return (
    <div style={{ position: 'relative', minHeight: mm(band.height), display: 'flex', alignItems: 'flex-start' }}>
      {decorations}
      {sorted.map((t, i) => {
        const prev = sorted[i - 1];
        const gap = t.x - (prev ? prev.x + prev.w : 0);
        return (
          <div key={i} style={{ ...textStyle(t, band), flex: 'none', marginLeft: mm(gap) }}>
            {t.text}
          </div>
        );
      })}
    </div>
  );
}

const PAGE_FONT: CSSProperties = {
  fontFamily: 'Arial, "Liberation Sans", Helvetica, sans-serif',
  letterSpacing: 'normal',
  fontFeatureSettings: 'normal',
  color: '#000',
  WebkitFontSmoothing: 'auto',
};

export function ReportPage({
  report,
  slice,
  index,
  total,
  size,
}: {
  report: PrintReport;
  slice: PageSlice;
  index: number;
  total: number;
  size: { w: number; h: number };
}) {
  return (
    <div
      className="mt-report-page"
      style={{
        ...PAGE_FONT,
        position: 'relative',
        width: mm(size.w),
        height: mm(size.h),
        padding: mm(PAGE_MARGIN_MM),
        boxSizing: 'border-box',
        background: '#fff',
        overflow: 'hidden',
      }}
    >
      {index === 0 && <BandView band={report.reportHeader} />}
      <BandView band={report.pageHeader} />
      {slice.bands.map((b) => (
        <BandView key={b} band={report.body[b]!} />
      ))}
      <div
        style={{
          position: 'absolute',
          left: mm(PAGE_MARGIN_MM),
          right: mm(PAGE_MARGIN_MM),
          bottom: mm(PAGE_MARGIN_MM),
        }}
      >
        <BandView band={report.pageFooter(index + 1, total)} />
      </div>
    </div>
  );
}

interface ReportPreviewProps {
  report: PrintReport;
  /** Shown in the toolbar, e.g. "Laporan Penjualan Rekap". */
  title: string;
  /** File name stem for the PDF (no extension). */
  fileName: string;
  /** Excel of the same report (from the server). */
  onExcel?: () => Promise<void>;
  /** Open the Windows print dialog as soon as the pages are ready (iPOS "Print" button). */
  autoPrint?: boolean;
  onClose: () => void;
}

export function ReportPreview({ report, title, fileName, onExcel, autoPrint = false, onClose }: ReportPreviewProps) {
  const bridge = desktopBridge();
  const [paper, setPaper] = useState<PaperKind>('A4');
  const [orientation, setOrientation] = useState<Orientation>(report.orientation);
  const [zoom, setZoom] = useState<number>(1);
  const [pages, setPages] = useState<PageSlice[] | null>(null);
  const [current, setCurrent] = useState(1);
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const printedRef = useRef(false);
  const size = pageSize(paper, orientation);
  const contentW = size.w - 2 * PAGE_MARGIN_MM;

  // Only the pages print while the preview is open (app.css .mt-report-printing).
  useEffect(() => {
    document.body.classList.add('mt-report-printing');
    rootRef.current?.focus();
    return () => document.body.classList.remove('mt-report-printing');
  }, []);

  // Measure every body band at the page width, then split into pages.
  useLayoutEffect(() => {
    const box = measureRef.current;
    if (!box) return;
    const heights = Array.from(box.children).map((el) => el.getBoundingClientRect().height / PX_PER_MM);
    const footer = report.pageFooter(1, 1).height;
    const usable = size.h - 2 * PAGE_MARGIN_MM - report.pageHeader.height - footer;
    setPages(
      paginate(
        heights,
        report.body.map((b) => !!b.keepWithNext),
        { first: usable - report.reportHeader.height, other: usable },
      ),
    );
  }, [report, size.h, contentW]);

  useEffect(() => {
    if (!autoPrint || !pages || printedRef.current) return;
    printedRef.current = true;
    const id = window.setTimeout(() => window.print(), 200); // let the logo image paint first
    return () => window.clearTimeout(id);
  }, [autoPrint, pages]);

  const total = pages?.length ?? 0;
  const goTo = (n: number) => {
    const p = Math.min(Math.max(1, n), total);
    setCurrent(p);
    scrollRef.current?.querySelectorAll('.mt-report-page')[p - 1]?.scrollIntoView({ block: 'start' });
  };
  const zoomBy = (dir: 1 | -1) => {
    const i = ZOOMS.indexOf(zoom as (typeof ZOOMS)[number]);
    setZoom(ZOOMS[Math.min(Math.max(0, i + dir), ZOOMS.length - 1)]!);
  };

  async function savePdf() {
    if (!bridge) return;
    setBusy('pdf');
    setMessage(null);
    try {
      const r = await bridge.saveReportPdf({ fileName, landscape: false, pageSizeMm: { w: size.w, h: size.h } });
      if (r.status === 'SAVED') setMessage({ tone: 'success', text: `PDF tersimpan: ${r.fileName}` });
      if (r.status === 'FAILED') setMessage({ tone: 'error', text: r.message });
    } finally {
      setBusy(null);
    }
  }

  async function saveXlsx() {
    if (!onExcel) return;
    setBusy('xlsx');
    setMessage(null);
    try {
      await onExcel();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'File Excel gagal dibuat.' });
    } finally {
      setBusy(null);
    }
  }

  const css = useMemo(() => `@page { size: ${size.w}mm ${size.h}mm; margin: 0; }`, [size.w, size.h]);

  return createPortal(
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`Pratinjau ${title}`}
      className="mt-report-print-root bg-canvas fixed inset-0 z-50 flex flex-col outline-none"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
          e.preventDefault();
          window.print();
        }
        if (e.key === 'PageDown') goTo(current + 1);
        if (e.key === 'PageUp') goTo(current - 1);
      }}
    >
      <style>{css}</style>

      <div className="mt-report-toolbar bg-background flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <div className="mr-auto min-w-0">
          <p className="truncate text-lg font-semibold">{title}</p>
          <p className="text-muted-foreground text-sm">
            {pages ? `${total} halaman · kertas ${PAPERS[paper].label}` : 'Menyusun halaman…'}
          </p>
        </div>

        <Select value={paper} onValueChange={(v) => setPaper(v as PaperKind)}>
          <SelectTrigger className="h-11 w-36 text-base" aria-label="Ukuran kertas">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[60]">
            {(Object.keys(PAPERS) as PaperKind[]).map((k) => (
              <SelectItem key={k} value={k} className="text-base">
                {PAPERS[k].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SegmentedControl label="Arah kertas" value={orientation} onChange={setOrientation} options={ORIENTATIONS} />

        <div className="flex items-center gap-1" aria-label="Perbesar">
          <Button variant="outline" size="icon" className="size-11" onClick={() => zoomBy(-1)} aria-label="Perkecil">
            <Minus />
          </Button>
          <span className="w-14 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <Button variant="outline" size="icon" className="size-11" onClick={() => zoomBy(1)} aria-label="Perbesar">
            <Plus />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-11"
            onClick={() => goTo(current - 1)}
            aria-label="Halaman sebelumnya"
            disabled={!pages}
          >
            <ChevronLeft />
          </Button>
          <span className="w-16 text-center tabular-nums">{pages ? `${current}/${total}` : '–'}</span>
          <Button
            variant="outline"
            size="icon"
            className="size-11"
            onClick={() => goTo(current + 1)}
            aria-label="Halaman berikutnya"
            disabled={!pages}
          >
            <ChevronRight />
          </Button>
        </div>

        {onExcel && (
          <Button variant="outline" className="h-11" onClick={() => void saveXlsx()} disabled={busy !== null}>
            {busy === 'xlsx' ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} Excel
          </Button>
        )}
        {bridge && (
          <Button variant="outline" className="h-11" onClick={() => void savePdf()} disabled={busy !== null || !pages}>
            {busy === 'pdf' ? <Loader2 className="animate-spin" /> : <FileText />} Simpan PDF
          </Button>
        )}
        <Button className="h-11" onClick={() => window.print()} disabled={!pages}>
          <Printer /> Cetak <kbd className="text-xs opacity-80">Ctrl+P</kbd>
        </Button>
        <Button variant="ghost" className="h-11" onClick={onClose}>
          <X /> Tutup <kbd className="text-xs opacity-70">Esc</kbd>
        </Button>
      </div>

      {message && (
        <Notice tone={message.tone} className="mt-report-toolbar mx-4 mt-3">
          {message.text}
        </Notice>
      )}

      <div
        ref={scrollRef}
        className="mt-report-scroll flex-1 overflow-auto p-6"
        onScroll={(e) => {
          const el = e.currentTarget;
          const top = el.getBoundingClientRect().top;
          let n = 1;
          el.querySelectorAll<HTMLElement>('.mt-report-page').forEach((p, i) => {
            if (p.getBoundingClientRect().top - top <= el.clientHeight / 3) n = i + 1;
          });
          if (n !== current) setCurrent(n);
        }}
      >
        <div className="mt-report-pages flex flex-col items-center gap-6" style={{ zoom }}>
          {pages?.map((slice, i) => (
            <div key={i} className="mt-report-sheet shadow-md">
              <ReportPage report={report} slice={slice} index={i} total={total} size={size} />
            </div>
          ))}
        </div>
      </div>

      {/* Off-screen copy of the body bands at the printable width, only for measuring. */}
      <div
        ref={measureRef}
        aria-hidden
        className="mt-report-measure"
        style={{ ...PAGE_FONT, position: 'fixed', left: -100000, top: 0, width: mm(contentW), visibility: 'hidden' }}
      >
        {report.body.map((b, i) => (
          <BandView key={i} band={b} />
        ))}
      </div>
    </div>,
    document.body,
  );
}
