// Login screen (sprint-2 D2, S2-5): pick your name, then type the PIN (6 digits, submits by
// itself) or the password. Keyboard-first: the name rows and the secret box are all reachable
// with Tab/Enter, Esc goes back to the name list.
import { ChevronRight, Delete, Eye, EyeOff, Hash, KeyRound, Loader2, Sprout } from 'lucide-react';
import { useRef, useState, type ButtonHTMLAttributes, type FormEvent } from 'react';
import type { LoginMethod, LoginUserCard } from '@shared/schemas/auth';
import { Notice } from '@/components/shared/Notice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLogin, useLoginUsers } from '@/features/auth/api';
import { ROLE_LABELS, useSessionStore } from '@/lib/session';
import { cn } from '@/lib/utils';

const PIN_LENGTH = 6;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="bg-tani-green-light text-tani-green-dark flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold">
      {initials(name)}
    </span>
  );
}

export function LoginScreen() {
  const users = useLoginUsers(true);
  const notice = useSessionStore((s) => s.notice);
  const [chosen, setPicked] = useState<LoginUserCard | null>(null);
  // One user only → straight to the PIN/password box.
  const picked = chosen ?? (users.data?.length === 1 ? users.data[0]! : null);
  const onBack = users.data && users.data.length > 1 ? () => setPicked(null) : undefined;

  return (
    <main className="bg-canvas flex min-h-screen flex-col items-center justify-center p-6">
      <div className="bg-background grid w-full max-w-5xl gap-6 rounded-[2rem] p-5 shadow-sm lg:grid-cols-2">
        <BrandPanel />

        <section className="flex flex-col items-center justify-center px-2 py-6 sm:px-8">
          <div className="w-full max-w-sm">
            <div className="mb-5 flex items-center justify-center gap-2.5">
              <span className="bg-primary text-primary-foreground flex size-11 items-center justify-center rounded-full">
                <Sprout className="size-5" aria-hidden />
              </span>
              <span className="text-xl font-bold">Mandiri Tani</span>
            </div>

            <div className="mb-6 text-center">
              <h1 className="text-[2rem] leading-tight font-bold tracking-tight">Selamat Datang</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                {picked ? 'Silakan masuk ke akun Anda' : 'Pilih nama Anda untuk masuk'}
              </p>
            </div>

            {notice && (
              <Notice tone="warning" className="mb-4">
                {notice}
              </Notice>
            )}

            {users.isPending && (
              <div className="text-muted-foreground flex items-center justify-center gap-2 py-10">
                <Loader2 className="size-5 animate-spin" aria-hidden />
                Memuat…
              </div>
            )}
            {users.isError && <Notice tone="error">{users.error.message}</Notice>}

            {users.data && !picked && (
              <ul className="space-y-2">
                {users.data.map((u, i) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      autoFocus={i === 0}
                      onClick={() => setPicked(u)}
                      className={cn(
                        'bg-canvas flex min-h-14 w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left',
                        'hover:bg-tani-green-light focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                      )}
                    >
                      <Avatar name={u.fullName} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{u.fullName}</span>
                        <span className="text-muted-foreground text-sm">{ROLE_LABELS[u.role]}</span>
                      </span>
                      <ChevronRight className="text-muted-foreground size-4" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {picked && <SecretForm key={picked.id} user={picked} onBack={onBack} />}
          </div>
        </section>
      </div>

      <p className="text-muted-foreground mt-5 text-center text-xs">
        Dibuat oleh Ido Refael Siregar · 081363554262 · idosiregar2006@gmail.com
      </p>
    </main>
  );
}

/** Left half: brand colour, headline and a small field illustration (inline SVG — app is offline). */
function BrandPanel() {
  return (
    <aside className="from-tani-green-dark via-tani-green relative hidden min-h-[520px] flex-col overflow-hidden rounded-3xl bg-gradient-to-b to-[color-mix(in_oklab,var(--color-tani-green)_55%,white)] p-10 text-white lg:flex">
      <h2 className="text-[2.5rem] leading-[1.2] font-bold tracking-tight">
        Kelola toko tani
        <br />
        jadi lebih{' '}
        <span className="relative inline-block">
          mudah.
          <svg
            className="absolute -bottom-2 left-0 w-full"
            viewBox="0 0 120 10"
            fill="none"
            preserveAspectRatio="none"
            aria-hidden
          >
            <path d="M2 7 C 35 2, 85 2, 118 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </span>
      </h2>
      <p className="mt-6 max-w-xs text-sm leading-relaxed text-white/85">
        Jual, cek stok, dan catat piutang pelanggan dari satu aplikasi di komputer kasir.
      </p>

      <FieldIllustration className="absolute inset-x-0 bottom-0 w-full" />
    </aside>
  );
}

function FieldIllustration({ className }: { className?: string }) {
  // Back hills → front hill, sun, a row of sprouts and two fertiliser sacks.
  return (
    <svg className={className} viewBox="0 0 400 300" fill="none" aria-hidden>
      <circle cx="318" cy="70" r="28" className="fill-tani-harvest" />
      <path d="M0 165 C 80 115, 170 130, 240 150 S 360 135, 400 118 V300 H0Z" className="fill-white/15" />
      <path d="M0 212 C 90 175, 210 186, 280 202 S 370 196, 400 185 V300 H0Z" className="fill-white/25" />
      <path d="M0 256 C 120 232, 260 236, 400 246 V300 H0Z" className="fill-tani-green-dark" />

      {[24, 70, 116, 162].map((x, i) => (
        <g key={x} transform={`translate(${x} ${214 - (i % 2) * 6}) scale(1.6)`}>
          <path d="M10 26 V8" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M10 14 C 2 14, -2 6, 0 0 C 7 1, 11 7, 10 14Z" className="fill-white" />
          <path d="M10 10 C 17 10, 22 3, 21 -3 C 14 -2, 9 3, 10 10Z" className="fill-white/80" />
        </g>
      ))}

      <Sack x={302} y={178} scale={1.1} label="BENIH" />
      <Sack x={232} y={186} scale={1.25} label="PUPUK" />
    </svg>
  );
}

function Sack({ x, y, scale, label }: { x: number; y: number; scale: number; label: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M6 10 C 6 2, 64 2, 64 10 L 70 74 C 70 82, 0 82, 0 74Z" className="fill-tani-cream" />
      <path d="M6 10 C 20 16, 50 16, 64 10" stroke="var(--color-tani-border)" strokeWidth="2" />
      <rect x="12" y="32" width="46" height="22" rx="3" className="fill-tani-green" />
      <text x="35" y="47" textAnchor="middle" className="fill-white" fontSize={10} fontWeight={700}>
        {label}
      </text>
      <text x="35" y="67" textAnchor="middle" className="fill-tani-soil" fontSize={8} fontWeight={600}>
        50 KG
      </text>
    </g>
  );
}

function SecretForm({ user, onBack }: { user: LoginUserCard; onBack?: () => void }) {
  const [method, setMethod] = useState<LoginMethod>(user.methods[0] ?? 'PIN');
  const [secret, setSecret] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const login = useLogin();
  const input = useRef<HTMLInputElement>(null);
  const other = user.methods.find((m) => m !== method);

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

  const typePin = (value: string) => {
    if (login.isPending) return;
    const v = value.replace(/\D/g, '').slice(0, PIN_LENGTH);
    setSecret(v);
    if (v.length === PIN_LENGTH) submit(v);
    input.current?.focus();
  };

  return (
    <form
      onSubmit={onSubmit}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && onBack) onBack();
      }}
      className="space-y-4"
    >
      <div className="bg-canvas flex items-center gap-3 rounded-xl px-3.5 py-2.5">
        <Avatar name={user.fullName} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{user.fullName}</p>
          <p className="text-muted-foreground text-sm">{ROLE_LABELS[user.role]}</p>
        </div>
      </div>

      {method === 'PIN' ? (
        <div>
          {/* Real input catches keyboard / numpad typing; the boxes below only show progress. */}
          <input
            ref={input}
            autoFocus
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={PIN_LENGTH}
            value={secret}
            aria-label="PIN"
            onChange={(e) => typePin(e.target.value)}
            className="sr-only"
          />
          <div
            role="presentation"
            onClick={() => input.current?.focus()}
            className="mb-3 grid cursor-text grid-cols-6 gap-2"
          >
            {Array.from({ length: PIN_LENGTH }, (_, i) => (
              <div
                key={i}
                className={cn(
                  'bg-canvas flex h-12 items-center justify-center rounded-xl border border-transparent',
                  i === secret.length && !login.isPending && 'border-primary bg-background',
                )}
              >
                {i < secret.length && <span className="bg-foreground size-2.5 rounded-full" />}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <NumKey key={d} onClick={() => typePin(secret + d)} disabled={login.isPending}>
                {d}
              </NumKey>
            ))}
            <NumKey onClick={() => typePin('')} disabled={login.isPending || !secret} className="text-sm">
              Hapus
            </NumKey>
            <NumKey onClick={() => typePin(secret + '0')} disabled={login.isPending}>
              0
            </NumKey>
            <NumKey
              onClick={() => typePin(secret.slice(0, -1))}
              disabled={login.isPending || !secret}
              aria-label="Hapus satu angka"
            >
              <Delete className="size-5" aria-hidden />
            </NumKey>
          </div>

          {login.isPending && (
            <p className="text-muted-foreground mt-3 flex items-center justify-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Memeriksa PIN…
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="relative">
            <Input
              ref={input}
              autoFocus
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={secret}
              placeholder="Password"
              aria-label="Password"
              onChange={(e) => setSecret(e.target.value)}
              className="bg-canvas focus-visible:bg-background h-12 rounded-xl border-transparent pr-11 shadow-none"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-4 -translate-y-1/2"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <Button
            type="submit"
            size="lg"
            className="h-12 w-full rounded-xl text-base"
            disabled={!secret || login.isPending}
          >
            {login.isPending && <Loader2 className="animate-spin" aria-hidden />}
            Masuk
          </Button>
        </>
      )}

      {login.isError && <Notice tone="error">{login.error.message}</Notice>}

      {other && (
        <>
          <div className="text-muted-foreground flex items-center gap-3 pt-1 text-xs">
            <span className="bg-border h-px flex-1" />
            atau masuk dengan
            <span className="bg-border h-px flex-1" />
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full rounded-xl"
            onClick={() => {
              setMethod(other);
              setSecret('');
              login.reset();
              setTimeout(() => input.current?.focus());
            }}
          >
            {other === 'PIN' ? <Hash aria-hidden /> : <KeyRound aria-hidden />}
            {other === 'PIN' ? 'PIN 6 angka' : 'Password'}
          </Button>
        </>
      )}

      {onBack && (
        <p className="text-muted-foreground pt-1 text-center text-sm">
          Bukan {user.fullName.split(/\s+/)[0]}?{' '}
          <button
            type="button"
            onClick={onBack}
            className="text-tani-green-dark font-semibold underline-offset-2 hover:underline"
          >
            Ganti pengguna
          </button>{' '}
          <kbd className="text-muted-foreground rounded border px-1 font-mono text-[11px]">Esc</kbd>
        </p>
      )}
    </form>
  );
}

function NumKey({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'bg-canvas h-11 rounded-xl text-lg font-semibold tabular-nums',
        'hover:bg-tani-green-light focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
      {...props}
    />
  );
}
