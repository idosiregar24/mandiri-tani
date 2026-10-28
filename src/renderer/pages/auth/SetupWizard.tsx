// First-run wizard (FR-SYS-01, sprint-2 D3): 1 store profile → 2 Owner account → 3 warehouse.
// One form validated step by step with the same SetupInput schema the server uses; the last
// step saves everything at once and logs the Owner in.
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight, Check, Leaf, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm, type FieldPath } from 'react-hook-form';
import type { z } from 'zod';
import { SetupInput, type SetupStatus } from '@shared/schemas/settings';
import { Notice } from '@/components/shared/Notice';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Centered } from '@/app/Centered';
import { useSetup } from '@/features/auth/api';
import { applyServerErrors } from '@/lib/form-errors';
import { cn } from '@/lib/utils';

type FormIn = z.input<typeof SetupInput>;
type FormOut = z.output<typeof SetupInput>;
const inputClass = 'h-11 text-base md:text-base';

const STEPS: { title: string; hint: string; fields: FieldPath<FormIn>[] }[] = [
  {
    title: 'Profil toko',
    hint: 'Dicetak di bagian atas nota dan faktur.',
    fields: ['store.name', 'store.address', 'store.phone'],
  },
  {
    title: 'Akun Pemilik',
    hint: 'Password untuk masuk ke menu pemilik. PIN dipakai untuk menyetujui aksi kasir.',
    fields: ['owner.fullName', 'owner.username', 'owner.password', 'owner.pin', 'owner.pinConfirm'],
  },
  {
    title: 'Gudang',
    hint: 'Kode gudang tetap UTM agar nomor nota sama dengan iPOS.',
    fields: ['warehouseName'],
  },
];

export function SetupWizard({ status }: { status: SetupStatus }) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const setup = useSetup();
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(SetupInput),
    defaultValues: {
      store: { name: '', address: '', phone: '' },
      owner: { fullName: '', username: '', password: '', pin: '', pinConfirm: '' },
      warehouseName: status.warehouse?.name ?? 'Gudang Utama',
    },
  });
  const last = step === STEPS.length - 1;

  const next = async () => {
    if (await form.trigger(STEPS[step]!.fields)) setStep((s) => s + 1);
  };
  const save = form.handleSubmit((values) => {
    setError(null);
    setup.mutate(values, {
      onError: (err) => {
        setError(applyServerErrors(form.setError, err));
        // Jump back to the first step that has a field error from the server.
        const bad = STEPS.findIndex((s) => s.fields.some((f) => form.getFieldState(f).error));
        if (bad >= 0) setStep(bad);
      },
    });
  });

  const field = (
    name: FieldPath<FormIn>,
    label: string,
    opts: { required?: boolean; type?: string; hint?: string } = {},
  ) => (
    <FormField
      key={name}
      control={form.control}
      name={name}
      render={({ field: f }) => (
        <FormItem>
          <FormLabel required={opts.required} className="text-base">
            {label}
          </FormLabel>
          <FormControl>
            <Input
              {...f}
              value={(f.value as string | null | undefined) ?? ''}
              type={opts.type ?? 'text'}
              inputMode={name.startsWith('owner.pin') ? 'numeric' : undefined}
              maxLength={name.startsWith('owner.pin') ? 6 : undefined}
              autoComplete="off"
              className={inputClass}
            />
          </FormControl>
          {opts.hint && <p className="text-muted-foreground text-sm">{opts.hint}</p>}
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Centered>
      <div className="bg-background rounded-2xl border p-8 shadow-xs">
        <div className="mb-6 flex items-center gap-3">
          <span className="bg-primary text-primary-foreground flex size-11 items-center justify-center rounded-xl">
            <Leaf className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold">Selamat datang</h1>
            <p className="text-muted-foreground">Siapkan aplikasi untuk pertama kali.</p>
          </div>
        </div>

        <ol className="mb-6 flex gap-2" aria-label="Langkah">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className={cn(
                'flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-sm',
                i === step ? 'border-primary bg-tani-green-light font-medium' : 'text-muted-foreground',
              )}
              aria-current={i === step ? 'step' : undefined}
            >
              <span
                className={cn(
                  'flex size-6 items-center justify-center rounded-full text-xs',
                  i < step ? 'bg-primary text-primary-foreground' : 'border',
                )}
              >
                {i < step ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              {s.title}
            </li>
          ))}
        </ol>

        <Form {...form}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (last) void save();
              else void next();
            }}
            className="space-y-4"
          >
            <div>
              <h2 className="text-xl font-semibold">{STEPS[step]!.title}</h2>
              <p className="text-muted-foreground">{STEPS[step]!.hint}</p>
            </div>

            {step === 0 && (
              <>
                {field('store.name', 'Nama toko', { required: true })}
                {field('store.address', 'Alamat')}
                {field('store.phone', 'No. telepon')}
              </>
            )}
            {step === 1 && (
              <>
                {field('owner.fullName', 'Nama', { required: true })}
                {field('owner.username', 'Username', { required: true, hint: 'Tanpa spasi, mis. budi' })}
                {field('owner.password', 'Password', { required: true, type: 'password', hint: 'Minimal 8 huruf' })}
                <div className="grid gap-4 sm:grid-cols-2">
                  {field('owner.pin', 'PIN (6 angka)', { required: true, type: 'password' })}
                  {field('owner.pinConfirm', 'Ulangi PIN', { required: true, type: 'password' })}
                </div>
              </>
            )}
            {step === 2 && (
              <>
                {field('warehouseName', 'Nama gudang', { required: true })}
                <p className="text-muted-foreground">
                  Kode gudang: <span className="font-mono">{status.warehouse?.code ?? 'UTM'}</span>
                </p>
              </>
            )}

            {error && <Notice tone="error">{error}</Notice>}

            <div className="flex justify-between gap-3 pt-2">
              {step > 0 ? (
                <Button type="button" variant="outline" className="h-11" onClick={() => setStep((s) => s - 1)}>
                  <ArrowLeft /> Kembali
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" size="lg" className="h-12 px-6 text-base" disabled={setup.isPending}>
                {setup.isPending ? <Loader2 className="animate-spin" /> : last ? <Check /> : <ArrowRight />}
                {last ? 'Simpan & mulai' : 'Lanjut'}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </Centered>
  );
}
