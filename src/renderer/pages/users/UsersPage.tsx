import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { KeyRound, Lock, MoreHorizontal, Plus, Shield } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DataTable } from '@/components/shared/DataTable';
import { Notice } from '@/components/shared/Notice';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatusPill } from '@/components/shared/StatusPill';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiGet, apiPost, apiPut } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { useSessionUser } from '@/lib/session';

export interface UserRow {
  id: string;
  username: string;
  fullName: string;
  role: 'OWNER' | 'KASIR';
  isActive: boolean;
  createdAt: string;
  hasPassword: boolean;
  hasPin: boolean;
}

export function UsersPage() {
  const qc = useQueryClient();
  const currentUser = useSessionUser();
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [pinTarget, setPinTarget] = useState<UserRow | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<UserRow | null>(null);
  const [toggleTarget, setToggleTarget] = useState<UserRow | null>(null);

  const query = useQuery({
    queryKey: ['users'],
    queryFn: () => apiGet<UserRow[]>('/users'),
  });

  const columns: ColumnDef<UserRow, unknown>[] = [
    {
      header: 'Pengguna',
      cell: ({ row }) => (
        <div>
          <p className="font-semibold text-foreground">{row.original.fullName}</p>
          <p className="text-muted-foreground text-xs font-mono">@{row.original.username}</p>
        </div>
      ),
    },
    {
      header: 'Peran',
      cell: ({ row }) => (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
            row.original.role === 'OWNER'
              ? 'bg-amber-100 text-amber-800'
              : 'bg-green-100 text-green-800'
          }`}
        >
          <Shield className="size-3" />
          {row.original.role === 'OWNER' ? 'Owner / Pemilik' : 'Kasir'}
        </span>
      ),
    },
    {
      header: 'Kredensial',
      cell: ({ row }) => (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {row.original.hasPin && (
            <span className="flex items-center gap-1 bg-surface-muted px-2 py-0.5 rounded">
              <KeyRound className="size-3" /> PIN 6-digit
            </span>
          )}
          {row.original.hasPassword && (
            <span className="flex items-center gap-1 bg-surface-muted px-2 py-0.5 rounded">
              <Lock className="size-3" /> Password
            </span>
          )}
        </div>
      ),
    },
    {
      header: 'Status',
      cell: ({ row }) => (
        <StatusPill tone={row.original.isActive ? 'success' : 'neutral'}>
          {row.original.isActive ? 'Aktif' : 'Nonaktif'}
        </StatusPill>
      ),
    },
    {
      header: 'Dibuat',
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs tabular-nums">
          {formatDateTime(row.original.createdAt)}
        </span>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const u = row.original;
        const isSelf = currentUser?.id === u.id;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="size-8 p-0">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditTarget(u)}>
                Ubah Nama & Peran
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPinTarget(u)}>
                Atur Ulang PIN
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPasswordTarget(u)}>
                Atur Ulang Password
              </DropdownMenuItem>
              {!isSelf && (
                <DropdownMenuItem
                  onClick={() => setToggleTarget(u)}
                  className={u.isActive ? 'text-destructive' : 'text-success-ink'}
                >
                  {u.isActive ? 'Nonaktifkan Pengguna' : 'Aktifkan Pengguna'}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Manajemen Pengguna"
        description="Kelola akun kasir dan pemilik toko, metode login PIN 6-digit, dan hak akses."
        actions={
          <Button onClick={() => setAddOpen(true)} className="gap-2">
            <Plus className="size-4" /> Tambah Pengguna
          </Button>
        }
      />

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <DataTable
        columns={columns}
        data={query.data ?? []}
        isLoading={query.isLoading}
        getRowId={(r) => r.id}
      />

      <AddUserDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSuccess={() => {
          setAddOpen(false);
          setMsg({ tone: 'success', text: 'Pengguna baru berhasil ditambahkan.' });
          void qc.invalidateQueries({ queryKey: ['users'] });
        }}
      />

      {editTarget && (
        <EditUserDialog
          user={editTarget}
          onClose={() => setEditTarget(null)}
          onSuccess={() => {
            setEditTarget(null);
            setMsg({ tone: 'success', text: 'Data pengguna berhasil diperbarui.' });
            void qc.invalidateQueries({ queryKey: ['users'] });
          }}
        />
      )}

      {pinTarget && (
        <ResetPinDialog
          user={pinTarget}
          onClose={() => setPinTarget(null)}
          onSuccess={() => {
            setPinTarget(null);
            setMsg({ tone: 'success', text: `PIN untuk ${pinTarget.fullName} berhasil diatur ulang.` });
            void qc.invalidateQueries({ queryKey: ['users'] });
          }}
        />
      )}

      {passwordTarget && (
        <ResetPasswordDialog
          user={passwordTarget}
          onClose={() => setPasswordTarget(null)}
          onSuccess={() => {
            setPasswordTarget(null);
            setMsg({ tone: 'success', text: `Password untuk ${passwordTarget.fullName} berhasil diatur ulang.` });
            void qc.invalidateQueries({ queryKey: ['users'] });
          }}
        />
      )}

      {toggleTarget && (
        <ConfirmDialog
          open={true}
          onOpenChange={(open) => !open && setToggleTarget(null)}
          title={toggleTarget.isActive ? 'Nonaktifkan Pengguna' : 'Aktifkan Pengguna'}
          description={
            toggleTarget.isActive
              ? `Pengguna ${toggleTarget.fullName} (@${toggleTarget.username}) tidak akan dapat masuk ke aplikasi kasir. Sesi yang sedang berjalan akan langsung dicabut.`
              : `Pengguna ${toggleTarget.fullName} (@${toggleTarget.username}) akan dapat masuk kembali.`
          }
          confirmLabel={toggleTarget.isActive ? 'Nonaktifkan' : 'Aktifkan'}
          tone={toggleTarget.isActive ? 'danger' : 'default'}
          onConfirm={async () => {
            try {
              await apiPost(`/users/${toggleTarget.id}/toggle-active`, {});
              setMsg({
                tone: 'success',
                text: `Status pengguna ${toggleTarget.fullName} berhasil diubah.`,
              });
              void qc.invalidateQueries({ queryKey: ['users'] });
            } catch (e) {
              setMsg({ tone: 'error', text: e instanceof Error ? e.message : 'Gagal mengubah status.' });
            } finally {
              setToggleTarget(null);
            }
          }}
        />
      )}
    </div>
  );
}

function AddUserDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<'KASIR' | 'OWNER'>('KASIR');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      setError('PIN harus berupa 6 digit angka.');
      return;
    }
    if (pin !== pinConfirm) {
      setError('Konfirmasi PIN tidak cocok.');
      return;
    }
    if (role === 'OWNER' && (!password || password.length < 8)) {
      setError('Owner wajib memiliki password minimal 8 karakter.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await apiPost('/users', {
        fullName,
        username,
        role,
        pin,
        pinConfirm,
        password: password || null,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menambahkan pengguna.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah Pengguna Baru</DialogTitle>
          <DialogDescription>Tambahkan akun kasir atau pemilik toko Mandiri Tani.</DialogDescription>
        </DialogHeader>

        {error && <Notice tone="error">{error}</Notice>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="addFullName">Nama Lengkap *</Label>
            <Input
              id="addFullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Contoh: Budi Santoso"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="addUsername">Username *</Label>
            <Input
              id="addUsername"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="budisantoso"
              required
            />
            <p className="text-muted-foreground text-xs">Digunakan untuk masuk (hanya huruf dan angka).</p>
          </div>

          <div className="space-y-1.5">
            <Label>Peran Akun *</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="role"
                  value="KASIR"
                  checked={role === 'KASIR'}
                  onChange={() => setRole('KASIR')}
                />
                Kasir
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="role"
                  value="OWNER"
                  checked={role === 'OWNER'}
                  onChange={() => setRole('OWNER')}
                />
                Owner / Pemilik
              </label>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="addPin">PIN 6-Digit *</Label>
              <Input
                id="addPin"
                type="password"
                maxLength={6}
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="123456"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="addPinConfirm">Ulangi PIN *</Label>
              <Input
                id="addPinConfirm"
                type="password"
                maxLength={6}
                inputMode="numeric"
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value)}
                placeholder="123456"
                required
              />
            </div>
          </div>

          {role === 'OWNER' && (
            <div className="space-y-1.5">
              <Label htmlFor="addPassword">Password Owner *</Label>
              <Input
                id="addPassword"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimal 8 karakter"
                required
              />
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Menyimpan...' : 'Simpan Pengguna'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  user,
  onClose,
  onSuccess,
}: {
  user: UserRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [fullName, setFullName] = useState(user.fullName);
  const [role, setRole] = useState<'KASIR' | 'OWNER'>(user.role);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiPut(`/users/${user.id}`, { fullName, role });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memperbarui pengguna.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ubah Pengguna @{user.username}</DialogTitle>
        </DialogHeader>

        {error && <Notice tone="error">{error}</Notice>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="editFullName">Nama Lengkap *</Label>
            <Input
              id="editFullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Peran Akun *</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="editRole"
                  value="KASIR"
                  checked={role === 'KASIR'}
                  onChange={() => setRole('KASIR')}
                />
                Kasir
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="editRole"
                  value="OWNER"
                  checked={role === 'OWNER'}
                  onChange={() => setRole('OWNER')}
                />
                Owner / Pemilik
              </label>
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Menyimpan...' : 'Simpan Perubahan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPinDialog({
  user,
  onClose,
  onSuccess,
}: {
  user: UserRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      setError('PIN harus berupa 6 digit angka.');
      return;
    }
    if (pin !== pinConfirm) {
      setError('Konfirmasi PIN tidak cocok.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await apiPost(`/users/${user.id}/pin`, { pin, pinConfirm });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengatur ulang PIN.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Atur Ulang PIN: {user.fullName}</DialogTitle>
          <DialogDescription>Masukkan 6 digit angka untuk PIN baru kasir.</DialogDescription>
        </DialogHeader>

        {error && <Notice tone="error">{error}</Notice>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="resetPin">PIN Baru (6 digit) *</Label>
              <Input
                id="resetPin"
                type="password"
                maxLength={6}
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="resetPinConfirm">Ulangi PIN *</Label>
              <Input
                id="resetPinConfirm"
                type="password"
                maxLength={6}
                inputMode="numeric"
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value)}
                required
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Menyimpan...' : 'Simpan PIN Baru'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  user,
  onClose,
  onSuccess,
}: {
  user: UserRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password minimal 8 karakter.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await apiPost(`/users/${user.id}/password`, { password });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengatur ulang password.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Atur Ulang Password: {user.fullName}</DialogTitle>
          <DialogDescription>Masukkan password baru minimal 8 karakter.</DialogDescription>
        </DialogHeader>

        {error && <Notice tone="error">{error}</Notice>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="resetPw">Password Baru *</Label>
            <Input
              id="resetPw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimal 8 karakter"
              required
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Menyimpan...' : 'Simpan Password Baru'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

