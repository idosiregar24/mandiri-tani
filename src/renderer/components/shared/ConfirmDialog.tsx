import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` for void / delete / deactivate (design-standards §2). */
  tone?: 'default' | 'danger';
  pending?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}

/** Replaces window.confirm, which blocks the scanner and IPC (golden rule 10). Esc cancels, Enter confirms. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Batal',
  tone = 'default',
  pending = false,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!pending) onConfirm();
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle className="text-xl">{title}</DialogTitle>
            {description && <DialogDescription className="text-base">{description}</DialogDescription>}
          </DialogHeader>
          {children}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="h-11 text-base"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              {cancelLabel}
            </Button>
            <Button
              type="submit"
              autoFocus
              variant={tone === 'danger' ? 'destructive' : 'default'}
              className="h-11 text-base"
              disabled={pending}
            >
              {pending && <Loader2 className="animate-spin" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
