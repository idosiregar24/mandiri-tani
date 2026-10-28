// Login screen (sprint-2 D2, S2-5): pick your name card, then type the PIN (6 digits, submits by
// itself) or the password. Keyboard-first: the name cards and the secret box are all reachable
// with Tab/Enter, Esc goes back to the name cards.
import { ArrowLeft, KeyRound, Leaf, Loader2, LogIn, UserRound } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import type { LoginMethod, LoginUserCard } from '@shared/schemas/auth';
import { Notice } from '@/components/shared/Notice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Centered } from '@/app/Centered';
import { useLogin, useLoginUsers } from '@/features/auth/api';
import { ROLE_LABELS, useSessionStore } from '@/lib/session';
import { cn } from '@/lib/utils';

const PIN_LENGTH = 6;

export function LoginScreen() {
  const users = useLoginUsers(true);
  const notice = useSessionStore((s) => s.notice);
  const [chosen, setPicked] = useState<LoginUserCard | null>(null);
  // One user only → straight to the PIN/password box.
  const picked = chosen ?? (users.data?.length === 1 ? users.data[0]! : null);

  return (
    <Centered>
      <div className="bg-background rounded-2xl border p-8 shadow-xs">
        <div className="mb-6 flex items-center gap-3">
          <span className="bg-primary text-primary-foreground flex size-11 items-center justify-center rounded-xl">
            <Leaf className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold">Masuk</h1>
            <p className="text-muted-foreground">Mandiri Tani POS</p>
          </div>
        </div>

        {notice && (
          <Notice tone="warning" className="mb-5">
            {notice}
          </Notice>
        )}

        {users.isPending && <Loader2 className="text-tani-green mx-auto size-8 animate-spin" aria-label="Memuat" />}
        {users.isError && <Notice tone="error">{users.error.message}</Notice>}

        {users.data && !picked && (
          <div>
            <p className="mb-3 text-lg">Siapa yang masuk?</p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {users.data.map((u, i) => (
                <li key={u.id}>
                  <button
                    type="button"
                    autoFocus={i === 0}
                    onClick={() => setPicked(u)}
                    className={cn(
                      'flex min-h-16 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
                      'hover:bg-tani-green-light focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                    )}
                  >
                    <UserRound className="text-tani-green-dark size-6 shrink-0" aria-hidden />
                    <span>
                      <span className="block text-lg font-semibold">{u.fullName}</span>
                      <span className="text-muted-foreground text-sm">{ROLE_LABELS[u.role]}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {picked && (
          <SecretForm
            key={picked.id}
            user={picked}
            onBack={users.data && users.data.length > 1 ? () => setPicked(null) : undefined}
          />
        )}
      </div>
    </Centered>
  );
}

function SecretForm({ user, onBack }: { user: LoginUserCard; onBack?: () => void }) {
  const [method, setMethod] = useState<LoginMethod>(user.methods[0] ?? 'PIN');
  const [secret, setSecret] = useState('');
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

  return (
    <form
      onSubmit={onSubmit}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && onBack) onBack();
      }}
      className="space-y-5"
    >
      <div className="flex items-center gap-3">
        <UserRound className="text-tani-green-dark size-7" aria-hidden />
        <div>
          <p className="text-xl font-semibold">{user.fullName}</p>
          <p className="text-muted-foreground">{ROLE_LABELS[user.role]}</p>
        </div>
      </div>

      <label className="block">
        <span className="mb-2 block text-lg">{method === 'PIN' ? 'PIN (6 angka)' : 'Password'}</span>
        {method === 'PIN' ? (
          <Input
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
            className="h-16 text-center font-mono text-4xl tracking-[0.6em] md:text-4xl"
          />
        ) : (
          <Input
            ref={input}
            autoFocus
            type="password"
            autoComplete="current-password"
            value={secret}
            aria-label="Password"
            onChange={(e) => setSecret(e.target.value)}
            className="h-12 text-lg md:text-lg"
          />
        )}
      </label>

      {login.isError && <Notice tone="error">{login.error.message}</Notice>}

      <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={!secret || login.isPending}>
        {login.isPending ? <Loader2 className="animate-spin" /> : <LogIn />} Masuk
      </Button>

      <div className="flex flex-wrap justify-between gap-2">
        {onBack ? (
          <Button type="button" variant="ghost" className="h-11" onClick={onBack}>
            <ArrowLeft /> Ganti pengguna
          </Button>
        ) : (
          <span />
        )}
        {other && (
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            onClick={() => {
              setMethod(other);
              setSecret('');
              login.reset();
              setTimeout(() => input.current?.focus());
            }}
          >
            <KeyRound /> {other === 'PIN' ? 'Pakai PIN' : 'Pakai password'}
          </Button>
        )}
      </div>
    </form>
  );
}
