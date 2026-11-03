// Login screen (sprint-2 D2, S2-5): pick your name card, then type the PIN (6 digits, submits by
// itself) or the password. Keyboard-first: the name cards and the secret box are all reachable
// with Tab/Enter, Esc goes back to the name cards.
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Delete,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogIn,
  ShieldCheck,
  Sparkles,
  Sprout,
  Store,
  UserCheck,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { LoginMethod, LoginUserCard } from '@shared/schemas/auth';
import { Notice } from '@/components/shared/Notice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLogin, useLoginUsers } from '@/features/auth/api';
import { ROLE_LABELS, useSessionStore } from '@/lib/session';
import { cn } from '@/lib/utils';

const PIN_LENGTH = 6;

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]?.slice(0, 2).toUpperCase() || 'U';
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function useLiveClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeString = now.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const dateString = now.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return { timeString, dateString };
}

export function LoginScreen() {
  const users = useLoginUsers(true);
  const notice = useSessionStore((s) => s.notice);
  const [chosen, setPicked] = useState<LoginUserCard | null>(null);
  const { timeString, dateString } = useLiveClock();

  // If there is only one user in the database, jump directly to credentials entry.
  const picked = chosen ?? (users.data?.length === 1 ? users.data[0]! : null);

  return (
    <main className="relative min-h-screen w-full bg-canvas flex flex-col justify-between p-4 sm:p-6 lg:p-8 overflow-hidden select-none">
      {/* Decorative ambient background glows */}
      <div
        className="pointer-events-none absolute -top-40 -left-40 size-[32rem] rounded-full bg-emerald-500/10 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-40 -right-40 size-[32rem] rounded-full bg-amber-500/10 blur-3xl"
        aria-hidden
      />

      {/* Main card container */}
      <div className="relative z-10 mx-auto my-auto w-full max-w-5xl overflow-hidden rounded-3xl border border-border/80 bg-card shadow-xl grid lg:grid-cols-12">
        {/* Left column: Brand & Operational Hub */}
        <aside className="relative lg:col-span-5 bg-gradient-to-br from-[#0c2e14] via-[#14421b] to-[#1e5828] text-white p-8 lg:p-10 flex flex-col justify-between overflow-hidden">
          {/* Subtle botanical backdrop ornament */}
          <div
            className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-emerald-400/10 blur-2xl"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -bottom-20 -left-20 size-60 rounded-full bg-green-300/10 blur-2xl"
            aria-hidden
          />

          {/* Brand header */}
          <div className="relative z-10 space-y-4">
            <div className="flex items-center gap-3.5">
              <span className="size-13 rounded-2xl bg-gradient-to-br from-emerald-400 via-green-500 to-emerald-600 flex items-center justify-center text-white shadow-lg ring-2 ring-white/20">
                <Sprout className="size-7" aria-hidden />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold tracking-tight text-white">MANDIRI TANI</h1>
                  <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-200 backdrop-blur-xs">
                    v0.2.0
                  </span>
                </div>
                <p className="text-xs text-emerald-100/80 font-medium">Sistem Kasir & Operasional Toko</p>
              </div>
            </div>

            <p className="text-xs text-emerald-100/70 leading-relaxed pt-1">
              Platform kasir cepat, manajemen stok FIFO terintegrasi, dan administrasi operasional toko pertanian.
            </p>
          </div>

          {/* Operational live clock & status widget */}
          <div className="relative z-10 my-8 space-y-4">
            <div className="rounded-2xl border border-white/15 bg-white/10 p-4.5 backdrop-blur-md shadow-inner">
              <div className="flex items-center justify-between text-xs text-emerald-200 mb-1.5">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Clock className="size-3.5 text-emerald-300" />
                  Waktu Sistem
                </span>
                <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-300">
                  <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                  Hub Aktif
                </span>
              </div>
              <div className="text-2xl font-bold tracking-tight text-white font-mono">{timeString} WIB</div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-emerald-100/90 font-medium">
                <Calendar className="size-3.5 text-emerald-300/80" />
                {dateString}
              </div>
            </div>

            {/* Quick feature highlights */}
            <div className="space-y-2 text-xs text-emerald-100/85">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-3.5 text-emerald-300 shrink-0" />
                <span>Kasir Cepat & Faktur Continuous Form LX-310</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-3.5 text-emerald-300 shrink-0" />
                <span>Manajemen Stok Bertingkat & HPP FIFO</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-3.5 text-emerald-300 shrink-0" />
                <span>Enkripsi Kredensial Argon2id & Audit Log</span>
              </div>
            </div>
          </div>

          {/* Developer credit card */}
          <div className="relative z-10 rounded-2xl border border-white/10 bg-black/20 p-3.5 backdrop-blur-xs text-xs">
            <p className="font-semibold text-white/95 flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-amber-300" />
              Dikembangkan oleh Ido Refael Siregar
            </p>
            <p className="mt-1 text-[11px] font-mono text-emerald-200/80">081363554262 &bull; idosiregar2006@gmail.com</p>
          </div>
        </aside>

        {/* Right column: Interactive Authentication */}
        <section className="relative lg:col-span-7 bg-card p-6 sm:p-8 lg:p-10 flex flex-col justify-between">
          <div className="space-y-6">
            {/* Header info */}
            <div>
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold tracking-tight text-foreground">
                  {picked ? 'Verifikasi Masuk' : 'Selamat Datang'}
                </h2>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground bg-surface-muted px-2.5 py-1 rounded-full border border-border/60">
                  <Store className="size-3.5 text-primary" />
                  Komputer Kasir
                </div>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {picked
                  ? 'Masukkan kredensial keamanan untuk memulai sesi.'
                  : 'Silakan pilih akun Anda untuk membuka sesi transaksi toko.'}
              </p>
            </div>

            {notice && (
              <Notice tone="warning" className="text-xs">
                {notice}
              </Notice>
            )}

            {users.isPending && (
              <div className="py-12 text-center">
                <Loader2 className="mx-auto size-9 animate-spin text-primary" aria-label="Memuat daftar pengguna" />
                <p className="mt-3 text-xs text-muted-foreground">Menyiapkan profil akun...</p>
              </div>
            )}

            {users.isError && <Notice tone="error">{users.error.message}</Notice>}

            {/* State A: User selection */}
            {users.data && !picked && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Pilih salah satu profil di bawah ini:</span>
                  <span className="font-medium text-foreground">{users.data.length} Akun Terdaftar</span>
                </div>

                <ul className="grid gap-3 sm:grid-cols-2">
                  {users.data.map((u, i) => {
                    const isOwner = u.role === 'OWNER';
                    return (
                      <li key={u.id}>
                        <button
                          type="button"
                          autoFocus={i === 0}
                          onClick={() => setPicked(u)}
                          className={cn(
                            'group flex min-h-20 w-full items-center gap-3.5 rounded-2xl border border-border p-3.5 text-left transition-all duration-150',
                            'bg-card hover:bg-surface-muted hover:border-primary/50 hover:shadow-md active:scale-[0.98]',
                            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                          )}
                        >
                          <div
                            className={cn(
                              'size-12 rounded-xl flex items-center justify-center font-bold text-base shrink-0 shadow-xs transition-transform group-hover:scale-105',
                              isOwner
                                ? 'bg-gradient-to-br from-amber-500 to-amber-700 text-white'
                                : 'bg-gradient-to-br from-emerald-600 to-green-700 text-white',
                            )}
                          >
                            {getInitials(u.fullName)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-1">
                              <span className="block truncate text-base font-bold text-foreground group-hover:text-primary transition-colors">
                                {u.fullName}
                              </span>
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                              <span
                                className={cn(
                                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border shrink-0',
                                  isOwner
                                    ? 'bg-amber-50 text-amber-900 border-amber-200/80'
                                    : 'bg-emerald-50 text-emerald-900 border-emerald-200/80',
                                )}
                              >
                                {isOwner ? (
                                  <ShieldCheck className="size-3 text-amber-600" />
                                ) : (
                                  <UserCheck className="size-3 text-emerald-600" />
                                )}
                                {ROLE_LABELS[u.role]}
                              </span>
                              <span className="text-[11px] text-muted-foreground truncate">
                                {u.methods.includes('PIN') ? 'PIN' : 'Password'}
                              </span>
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* State B: Credentials entry form */}
            {picked && (
              <SecretForm
                key={picked.id}
                user={picked}
                onBack={users.data && users.data.length > 1 ? () => setPicked(null) : undefined}
              />
            )}
          </div>

          {/* Subtle bottom note */}
          <div className="mt-6 pt-4 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Mandiri Tani POS &bull; Terminal Utama</span>
            <span className="font-mono">Port 5438 &bull; PG 18</span>
          </div>
        </section>
      </div>
    </main>
  );
}

function SecretForm({ user, onBack }: { user: LoginUserCard; onBack?: () => void }) {
  const [method, setMethod] = useState<LoginMethod>(user.methods[0] ?? 'PIN');
  const [secret, setSecret] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const login = useLogin();
  const input = useRef<HTMLInputElement>(null);
  const other = user.methods.find((m) => m !== method);
  const isOwner = user.role === 'OWNER';

  const submit = (value = secret) => {
    if (!value || login.isPending) return;
    login.mutate(
      { username: user.username, method, secret: value },
      {
        onError: () => {
          setSecret('');
          input.current?.focus();
        },
      },
    );
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  const handleNumpad = (digit: string) => {
    if (login.isPending) return;
    if (secret.length < PIN_LENGTH) {
      const next = secret + digit;
      setSecret(next);
      if (next.length === PIN_LENGTH) {
        submit(next);
      }
    }
  };

  const handleBackspace = () => {
    if (login.isPending) return;
    setSecret((s) => s.slice(0, -1));
    input.current?.focus();
  };

  const handleClear = () => {
    if (login.isPending) return;
    setSecret('');
    input.current?.focus();
  };

  return (
    <form
      onSubmit={onSubmit}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && onBack) onBack();
      }}
      className="space-y-5"
    >
      {/* Active User Card Banner */}
      <div className="rounded-2xl border border-border/80 bg-surface-muted/60 p-3.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              'size-11 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 text-white shadow-xs',
              isOwner
                ? 'bg-gradient-to-br from-amber-500 to-amber-700'
                : 'bg-gradient-to-br from-emerald-600 to-green-700',
            )}
          >
            {getInitials(user.fullName)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-base font-bold truncate text-foreground">{user.fullName}</p>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border shrink-0',
                  isOwner
                    ? 'bg-amber-50 text-amber-900 border-amber-200/80'
                    : 'bg-emerald-50 text-emerald-900 border-emerald-200/80',
                )}
              >
                {isOwner ? <ShieldCheck className="size-3 text-amber-600" /> : <UserCheck className="size-3 text-emerald-600" />}
                {ROLE_LABELS[user.role]}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              @{user.username} &bull; {method === 'PIN' ? 'Mode Cepat PIN 6 Digit' : 'Mode Kata Sandi'}
            </p>
          </div>
        </div>

        {onBack && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground shrink-0"
            onClick={onBack}
            title="Ganti Pengguna (Esc)"
          >
            <ArrowLeft className="size-3.5 mr-1" />
            <span className="hidden sm:inline">Ganti</span>
            <kbd className="ml-1 text-[10px] bg-background border px-1 py-0.5 rounded text-muted-foreground font-mono">
              Esc
            </kbd>
          </Button>
        )}
      </div>

      {/* Secret Entry: PIN or Password */}
      {method === 'PIN' ? (
        <div className="space-y-4">
          <div className="text-center">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Masukkan 6 Digit PIN
            </span>
          </div>

          {/* Hidden input to handle hardware keyboard / numpad input */}
          <input
            ref={input}
            autoFocus
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={PIN_LENGTH}
            value={secret}
            aria-label="PIN"
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH);
              setSecret(v);
              if (v.length === PIN_LENGTH) submit(v);
            }}
            className="sr-only"
          />

          {/* Visual 6-slot indicator */}
          <div
            onClick={() => input.current?.focus()}
            className="flex justify-center items-center gap-3 sm:gap-4 my-2 cursor-pointer select-none"
            role="presentation"
            title="Klik untuk mengetik PIN"
          >
            {Array.from({ length: PIN_LENGTH }).map((_, idx) => {
              const isFilled = idx < secret.length;
              const isCurrent = idx === secret.length && !login.isPending;
              return (
                <div
                  key={idx}
                  className={cn(
                    'size-11 sm:size-13 rounded-2xl border-2 flex items-center justify-center transition-all duration-150',
                    isFilled
                      ? 'border-primary bg-primary/10 shadow-xs'
                      : isCurrent
                        ? 'border-primary ring-4 ring-primary/20 bg-background scale-105'
                        : 'border-border bg-surface-muted/50',
                  )}
                >
                  {isFilled ? (
                    <span className="size-4 rounded-full bg-primary animate-in zoom-in-50 duration-150 shadow-xs" />
                  ) : (
                    <span
                      className={cn(
                        'size-2 rounded-full',
                        isCurrent ? 'bg-primary/50 animate-pulse' : 'bg-muted-foreground/20',
                      )}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* On-screen tactile numpad */}
          <div className="grid grid-cols-3 gap-2 max-w-[260px] mx-auto w-full pt-1">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button
                key={digit}
                type="button"
                onClick={() => {
                  handleNumpad(digit);
                  input.current?.focus();
                }}
                disabled={login.isPending}
                className={cn(
                  'h-11 rounded-xl text-lg font-bold border border-border bg-card text-foreground shadow-2xs',
                  'hover:bg-surface-muted hover:border-foreground/20 active:scale-95 transition-all duration-100',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  'disabled:opacity-50 disabled:pointer-events-none',
                )}
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              onClick={handleClear}
              disabled={login.isPending || !secret}
              aria-label="Bersihkan PIN"
              className={cn(
                'h-11 rounded-xl text-xs font-semibold uppercase tracking-wider border border-border bg-surface-muted/60 text-muted-foreground',
                'hover:bg-surface-muted hover:text-foreground active:scale-95 transition-all duration-100',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                'disabled:opacity-40 disabled:pointer-events-none',
              )}
            >
              Hapus
            </button>
            <button
              type="button"
              onClick={() => {
                handleNumpad('0');
                input.current?.focus();
              }}
              disabled={login.isPending}
              className={cn(
                'h-11 rounded-xl text-lg font-bold border border-border bg-card text-foreground shadow-2xs',
                'hover:bg-surface-muted hover:border-foreground/20 active:scale-95 transition-all duration-100',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                'disabled:opacity-50 disabled:pointer-events-none',
              )}
            >
              0
            </button>
            <button
              type="button"
              onClick={handleBackspace}
              disabled={login.isPending || !secret}
              aria-label="Hapus satu angka"
              className={cn(
                'h-11 rounded-xl flex items-center justify-center border border-border bg-surface-muted/60 text-muted-foreground',
                'hover:bg-surface-muted hover:text-foreground active:scale-95 transition-all duration-100',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                'disabled:opacity-40 disabled:pointer-events-none',
              )}
            >
              <Delete className="size-5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Kata Sandi Pengguna
            </span>
            <div className="relative">
              <Input
                ref={input}
                autoFocus
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={secret}
                placeholder="Masukkan kata sandi..."
                aria-label="Password"
                onChange={(e) => setSecret(e.target.value)}
                className="h-12 text-base pr-11"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </label>

          <Button type="submit" size="lg" className="h-12 w-full text-base font-semibold" disabled={!secret || login.isPending}>
            {login.isPending ? <Loader2 className="animate-spin" /> : <LogIn className="size-4 mr-2" />} Masuk ke Sistem
          </Button>
        </div>
      )}

      {login.isError && (
        <Notice tone="error" className="text-xs">
          {login.error.message}
        </Notice>
      )}

      {/* Switch method action */}
      {other && (
        <div className="pt-2 text-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              setMethod(other);
              setSecret('');
              login.reset();
              setTimeout(() => input.current?.focus());
            }}
          >
            <KeyRound className="size-3.5 mr-1.5" />
            {other === 'PIN' ? 'Masuk Menggunakan PIN 6-Digit' : 'Masuk Menggunakan Kata Sandi'}
          </Button>
        </div>
      )}
    </form>
  );
}
