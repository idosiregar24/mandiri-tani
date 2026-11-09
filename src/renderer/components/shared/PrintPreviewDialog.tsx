// "Pratinjau" of a document before (or instead of) printing it: the same PrintDocument the
// printer would get, drawn as paper — LX-310 continuous form or thermal roll — with the logo.
// Optional: printing never goes through here (owner 2026-11-09).
import { Loader2, Printer, Scissors } from 'lucide-react';
import { Fragment } from 'react';
import type { PrintDocument, PrinterSettings } from '@shared/printing';
import { MonoBitmapCanvas } from '@/components/shared/MonoBitmapCanvas';
import { Notice } from '@/components/shared/Notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { type PreviewLayout, type PreviewLine, previewLayout } from '@/lib/print-preview';
import { cn } from '@/lib/utils';

export type PrintPreviewState =
  | { status: 'loading' }
  | { status: 'ready'; doc: PrintDocument; printers: PrinterSettings }
  | { status: 'error'; message: string };

interface PrintPreviewDialogProps {
  state: PrintPreviewState;
  onClose: () => void;
  /** Shown as the main button; omitted = preview only. */
  onPrint?: () => void;
}

const ROLE_LABEL = { faktur: 'Printer faktur (Epson LX-310)', struk: 'Printer struk (thermal)' } as const;

export function PrintPreviewDialog({ state, onClose, onPrint }: PrintPreviewDialogProps) {
  const ready = state.status === 'ready' ? state : null;
  const layout = ready ? previewLayout(ready.doc, ready.printers) : null;
  const printerName = ready ? ready.printers[ready.doc.role].printer : null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Pratinjau cetak</DialogTitle>
          <DialogDescription className="text-base">
            {ready
              ? `${ready.doc.title} · ${ROLE_LABEL[ready.doc.role]}${printerName ? `: ${printerName}` : ' (belum diatur)'}`
              : 'Menyiapkan tampilan…'}
          </DialogDescription>
        </DialogHeader>

        {state.status === 'loading' && (
          <p className="text-muted-foreground flex items-center gap-2 py-8">
            <Loader2 className="size-4 animate-spin" /> Menyiapkan pratinjau…
          </p>
        )}
        {state.status === 'error' && <Notice tone="error">{state.message}</Notice>}
        {layout && (
          <>
            <div className="bg-canvas max-h-[62vh] space-y-6 overflow-auto rounded-lg p-4">
              {layout.pages.map((page, i) => (
                <Paper key={i} layout={layout} lines={page} index={i} total={layout.pages.length} />
              ))}
            </div>
            <p className="text-muted-foreground text-sm">
              Tampilan perkiraan — bentuk huruf di kertas mengikuti printer, isi dan letaknya sama.
            </p>
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-11" onClick={onClose}>
            Tutup <kbd className="ml-1 text-xs opacity-70">Esc</kbd>
          </Button>
          {onPrint && (
            <Button autoFocus className="h-11 px-6" disabled={!ready} onClick={onPrint}>
              <Printer /> Cetak <kbd className="ml-1 text-xs opacity-70">Enter</kbd>
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface PaperProps {
  layout: PreviewLayout;
  lines: PreviewLine[];
  index: number;
  total: number;
}

/** One form (faktur) or one receipt (struk), sized in characters like the real paper. */
function Paper({ layout, lines, index, total }: PaperProps) {
  const faktur = layout.role === 'faktur';
  const padCh = faktur ? 4 : 1.5;
  const { logo } = layout;
  return (
    <div className="mx-auto w-fit">
      {total > 1 && (
        <p className="text-muted-foreground mb-1 text-xs">
          {faktur ? 'Lembar' : 'Struk'} {index + 1} dari {total}
        </p>
      )}
      <div
        className={cn(
          'bg-background text-foreground border font-mono shadow-xs',
          faktur ? 'border-b-2 border-dashed text-[12.5px]' : 'text-sm',
        )}
        style={{
          width: `${layout.columns + padCh * 2}ch`,
          padding: `${faktur ? 1 : 2}ch ${padCh}ch`,
          minHeight: layout.formLines ? `${(layout.formLines + 1) * layout.lineCh}ch` : undefined,
        }}
      >
        <div className="relative">
          {logo?.kind === 'overlay' && (
            <MonoBitmapCanvas
              bitmap={logo.bitmap}
              className="absolute left-0"
              style={{ top: `${logo.topCh}ch`, width: `${logo.widthCh}ch`, height: `${logo.heightCh}ch` }}
            />
          )}
          {lines.map((l, i) => (
            <Fragment key={i}>
              {logo?.kind === 'block' && logo.beforeLine === i && (
                <MonoBitmapCanvas
                  bitmap={logo.bitmap}
                  className="mx-auto"
                  style={{ width: `${logo.widthCh}ch`, height: `${logo.heightCh}ch` }}
                />
              )}
              <Line line={l} lineCh={layout.lineCh} faktur={faktur} />
            </Fragment>
          ))}
        </div>
      </div>
      {layout.cut && (
        <p className="text-muted-foreground mt-1 flex items-center justify-center gap-1 text-xs">
          <Scissors className="size-3" /> kertas dipotong
        </p>
      )}
    </div>
  );
}

function Line({ line, lineCh, faktur }: { line: PreviewLine; lineCh: number; faktur: boolean }) {
  // Thermal "double" = twice as wide and tall; LX-310 double width only.
  const height = `${line.double && !faktur ? lineCh * 2 : lineCh}ch`;
  return (
    <div className="overflow-hidden whitespace-pre" style={{ height, lineHeight: height }}>
      <span
        className={cn(line.bold && 'font-bold', line.double && (faktur ? 'inline-block origin-left scale-x-200' : ''))}
        style={line.double && !faktur ? { fontSize: '2em' } : undefined}
      >
        {line.text || ' '}
      </span>
    </div>
  );
}
