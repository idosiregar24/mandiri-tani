// The extra "Pratinjau" button next to a "Cetak" button. Printing stays one click; this only
// shows the same document first. `build` must be the builder the print helper uses.
import { Eye } from 'lucide-react';
import { type ComponentProps, useRef, useState } from 'react';
import type { PrintDocument } from '@shared/printing';
import { PrintPreviewDialog, type PrintPreviewState } from '@/components/shared/PrintPreviewDialog';
import { Button } from '@/components/ui/button';
import { loadPrinterSettings } from '@/lib/desktop';

interface PrintPreviewButtonProps {
  /** Builds the document exactly as printing would (same copy flag, same store/logo). */
  build: () => Promise<PrintDocument> | PrintDocument;
  /** "Cetak" inside the preview; omitted = preview only. */
  onPrint?: () => void;
  size?: ComponentProps<typeof Button>['size'];
  className?: string;
  disabled?: boolean;
}

export function PrintPreviewButton({ build, onPrint, size, className, disabled }: PrintPreviewButtonProps) {
  const [state, setState] = useState<PrintPreviewState | null>(null);
  // A preview closed while loading must not reopen when its document arrives.
  const request = useRef(0);

  const open = async () => {
    const id = ++request.current;
    setState({ status: 'loading' });
    try {
      const [doc, printers] = await Promise.all([build(), loadPrinterSettings()]);
      if (id === request.current) setState({ status: 'ready', doc, printers });
    } catch (err) {
      if (id === request.current)
        setState({ status: 'error', message: err instanceof Error ? err.message : 'Gagal menyiapkan pratinjau.' });
    }
  };
  const close = () => {
    request.current++;
    setState(null);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        className={className}
        disabled={disabled}
        onClick={() => void open()}
      >
        <Eye /> Pratinjau
      </Button>
      {state && (
        <PrintPreviewDialog
          state={state}
          onClose={close}
          onPrint={
            onPrint
              ? () => {
                  close();
                  onPrint();
                }
              : undefined
          }
        />
      )}
    </>
  );
}
