// Owner PIN on the cashier's screen (FR-POS-20, security-standards §2.3): after a 423 the Owner
// types username + PIN; the one-shot grant (≤ 2 min, this action only) is handed back to retry.
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { Permission } from '@shared/permissions';
import type { AuthorizationGrantResult } from '@shared/schemas/auth';
import { Notice } from '@/components/shared/Notice';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { apiPost, ApiError } from '@/lib/api-client';

const REMEMBER_KEY = 'mtpos.authorize.username';

interface AuthorizeDialogProps {
  /** The permission the server asked for (423 details.permission). */
  permission: Permission;
  /** The server's sentence ("Butuh PIN Owner: harga di bawah harga pokok."). */
  reason: string;
  onGranted: (grant: string) => void;
  onCancel: () => void;
}

export function AuthorizeDialog({ permission, reason, onGranted, onCancel }: AuthorizeDialogProps) {
  const [username, setUsername] = useState(() => {
    try {
      return localStorage.getItem(REMEMBER_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!username.trim() || pin.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<AuthorizationGrantResult>('/auth/authorize', {
        username: username.trim(),
        pin,
        permission,
      });
      try {
        localStorage.setItem(REMEMBER_KEY, username.trim());
      } catch {
        // per-viewer convenience only
      }
      onGranted(r.grant);
    } catch (err) {
      setPin('');
      setError(err instanceof ApiError ? err.message : 'Gagal memeriksa PIN.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <ShieldCheck className="text-tani-green size-6" /> PIN Owner
          </DialogTitle>
          <DialogDescription className="text-base">{reason}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-4"
        >
          <label className="block space-y-1.5">
            <span className="font-medium">Username Owner</span>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus={!username}
              autoComplete="off"
              className="h-11 text-base md:text-base"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="font-medium">PIN (6 angka)</span>
            <div className="relative">
              <KeyRound className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2" />
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                autoFocus={!!username}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoComplete="off"
                className="h-14 pl-11 text-2xl tracking-[0.5em] md:text-2xl"
              />
            </div>
          </label>
          {error && <Notice tone="error">{error}</Notice>}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onCancel}>
              Batal
            </Button>
            <Button type="submit" className="h-11 px-5" disabled={busy || pin.length !== 6 || !username.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Setujui
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
