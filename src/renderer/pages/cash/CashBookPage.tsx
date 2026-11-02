// Buku Kas (FR-FIN-01/02, sprint-10 E3): balance per account, the cash ledger, and the three manual
// entries — Kas Masuk, Kas Keluar, Setor/Pindah Kas. Nothing can be edited or deleted; a mistake is
// fixed with an entry the other way. The cashier sees and uses only the drawer (Laci Kasir).
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, Landmark, Loader2, Tags, Wallet } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { CashAccountBalance, CashCategory, CashTransaction } from '@shared/schemas/cash';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { Notice } from '@/components/shared/Notice';
import { PageHeader } from '@/components/shared/PageHeader';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
import { StatCard } from '@/components/shared/StatCard';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  useAddCashEntry,
  useCashBalances,
  useCashCategories,
  useCashTransactions,
  useCashTransfer,
  useSaveCashCategory,
} from '@/features/cash/api';
import { todayJakarta } from '@/features/pos/api';
import { formatDateTime, formatRupiah } from '@/lib/format';
import { useCan } from '@/lib/session';
import { cn } from '@/lib/utils';

const KIND_ICON = { DRAWER: Wallet, CASH: Banknote, BANK: Landmark } as const;
const KIND_TEXT = { DRAWER: 'Laci kasir', CASH: 'Kas toko / brankas', BANK: 'Rekening bank' } as const;

const columns: ColumnDef<CashTransaction, unknown>[] = [
  {
    header: 'Tanggal',
    cell: ({ row }) => (
      <div>
        <p className="whitespace-nowrap">{formatDateTime(row.original.trxAt)}</p>
        {row.original.number && <p className="text-muted-foreground text-sm">{row.original.number}</p>}
      </div>
    ),
  },
  {
    header: 'Keterangan',
    cell: ({ row }) => (
      <div>
        <p className="font-medium">{row.original.category.name}</p>
        {row.original.note && <p className="text-muted-foreground text-sm">{row.original.note}</p>}
      </div>
    ),
    meta: { className: 'min-w-64' },
  },
  { header: 'Akun', cell: ({ row }) => row.original.account.name },
  {
    header: 'Masuk',
    cell: ({ row }) =>
      row.original.direction === 'IN' ? (
        <span className="text-success-ink font-medium">{formatRupiah(row.original.amount)}</span>
      ) : (
        ''
      ),
    meta: { align: 'right', className: 'whitespace-nowrap' },
  },
  {
    header: 'Keluar',
    cell: ({ row }) =>
      row.original.direction === 'OUT' ? (
        <span className="text-error-ink font-medium">{formatRupiah(row.original.amount)}</span>
      ) : (
        ''
      ),
    meta: { align: 'right', className: 'whitespace-nowrap' },
  },
  { header: 'Oleh', cell: ({ row }) => row.original.createdBy ?? '—' },
];

type Dialogs = { kind: 'entry'; direction: 'IN' | 'OUT' } | { kind: 'transfer' } | { kind: 'categories' } | null;

export function CashBookPage() {
  const owner = useCan('reports.cashflow');
  const balances = useCashBalances();
  const [accountId, setAccountId] = useState('all');
  const [page, setPage] = useState(1);
  const list = useCashTransactions({ accountId: accountId === 'all' ? undefined : accountId, page });
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const accounts = balances.data ?? [];

  const done = (msg: string) => {
    setDialog(null);
    setSaved(msg);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Buku Kas"
        description="Uang masuk dan keluar di laci, kas toko, dan rekening. Penjualan, pembelian, dan pelunasan tercatat otomatis."
        actions={
          <>
            <Button variant="outline" className="h-11" onClick={() => setDialog({ kind: 'entry', direction: 'IN' })}>
              <ArrowDownLeft /> Kas masuk
            </Button>
            {owner && (
              <Button variant="outline" className="h-11" onClick={() => setDialog({ kind: 'transfer' })}>
                <ArrowLeftRight /> Setor / pindah kas
              </Button>
            )}
            {owner && (
              <Button variant="outline" className="h-11" onClick={() => setDialog({ kind: 'categories' })}>
                <Tags /> Kategori biaya
              </Button>
            )}
            <Button size="lg" className="h-11 text-base" onClick={() => setDialog({ kind: 'entry', direction: 'OUT' })}>
              <ArrowUpRight /> Kas keluar
            </Button>
          </>
        }
      />
      {saved && <Notice tone="success">{saved}</Notice>}
      {balances.isError && <Notice tone="error">{balances.error.message}</Notice>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {accounts.map((a) => (
          <StatCard
            key={a.id}
            label={a.name}
            icon={KIND_ICON[a.kind]}
            value={formatRupiah(a.balance)}
            hint={KIND_TEXT[a.kind]}
          />
        ))}
      </div>

      {accounts.length > 1 && (
        <SegmentedControl
          label="Akun"
          value={accountId}
          onChange={(v) => {
            setAccountId(v);
            setPage(1);
          }}
          options={[{ value: 'all', label: 'Semua akun' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
        />
      )}
      {list.isError && <Notice tone="error">{list.error.message}</Notice>}
      <DataTable
        columns={columns}
        data={list.data?.data ?? []}
        getRowId={(r) => r.id}
        isLoading={list.isFetching}
        paging={
          list.data && { page, pageSize: list.data.meta.pageSize, total: list.data.meta.total, onPageChange: setPage }
        }
        empty={<EmptyState icon={Wallet} title="Belum ada uang masuk atau keluar" />}
      />

      {dialog?.kind === 'entry' && (
        <EntryDialog
          direction={dialog.direction}
          accounts={accounts}
          canBackdate={owner}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      )}
      {dialog?.kind === 'transfer' && (
        <TransferDialog accounts={accounts} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog?.kind === 'categories' && <CategoriesDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

function AccountChips({
  accounts,
  value,
  onChange,
}: {
  accounts: CashAccountBalance[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {accounts.map((a) => (
        <button
          key={a.id}
          type="button"
          role="radio"
          aria-checked={value === a.id}
          onClick={() => onChange(a.id)}
          className={cn(
            'h-11 rounded-lg border px-4 text-base',
            value === a.id ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-surface-muted',
          )}
        >
          {a.name}
        </button>
      ))}
    </div>
  );
}

function EntryDialog({
  direction,
  accounts,
  canBackdate,
  onClose,
  onSaved,
}: {
  direction: 'IN' | 'OUT';
  accounts: CashAccountBalance[];
  canBackdate: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const categories = useCashCategories();
  const add = useAddCashEntry();
  const choices = (categories.data ?? []).filter(
    (c) => c.manual && (c.direction === direction || c.direction === 'BOTH'),
  );
  // Owner: Kas Toko first; the cashier only has the drawer.
  const defaultAccount = accounts.find((a) => a.kind === 'CASH') ?? accounts[0];
  const [accountId, setAccountId] = useState(defaultAccount?.id ?? '');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayJakarta());
  const ok = accountId && categoryId && amount && note.trim();
  const words = direction === 'IN' ? 'Kas masuk' : 'Kas keluar';

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">{words}</DialogTitle>
          <DialogDescription className="text-base">
            {direction === 'IN'
              ? 'Uang masuk di luar penjualan, mis. modal awal kas atau pendapatan lain.'
              : 'Biaya toko, mis. ongkos ekspedisi, upah bongkar, solar, atau prive.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ok) return;
            add.mutate(
              {
                direction,
                cashAccountId: accountId,
                categoryId,
                amount,
                note: note.trim(),
                date: canBackdate ? date : null,
              },
              { onSuccess: (t) => onSaved(`${words} ${t.number ?? ''} tersimpan: ${formatRupiah(t.amount)}.`) },
            );
          }}
        >
          <Field label={direction === 'IN' ? 'Masuk ke' : 'Diambil dari'}>
            <AccountChips accounts={accounts} value={accountId} onChange={setAccountId} />
          </Field>
          <Field label="Kategori">
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {choices.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={categoryId === c.id}
                  onClick={() => setCategoryId(c.id)}
                  className={cn(
                    'h-11 rounded-lg border px-3 text-base',
                    categoryId === c.id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'hover:bg-surface-muted',
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Jumlah">
            <MoneyInput value={amount} onChange={setAmount} className="h-11" autoFocus />
          </Field>
          <Field label="Keterangan">
            <Input value={note} onChange={(e) => setNote(e.target.value)} className="h-11" maxLength={200} />
          </Field>
          {canBackdate && (
            <Field label="Tanggal">
              <Input
                type="date"
                value={date}
                max={todayJakarta()}
                onChange={(e) => setDate(e.target.value)}
                className="h-11"
              />
            </Field>
          )}
          {add.error && <Notice tone="error">{add.error.message}</Notice>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" className="h-11 px-5" disabled={!ok || add.isPending}>
              {add.isPending && <Loader2 className="animate-spin" />} Simpan
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({
  accounts,
  onClose,
  onSaved,
}: {
  accounts: CashAccountBalance[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const transfer = useCashTransfer();
  const drawer = accounts.find((a) => a.kind === 'DRAWER');
  const [fromId, setFromId] = useState(drawer?.id ?? accounts[0]?.id ?? '');
  const [toId, setToId] = useState(accounts.find((a) => a.kind === 'CASH')?.id ?? '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const ok = fromId && toId && fromId !== toId && amount;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">Setor / pindah kas</DialogTitle>
          <DialogDescription className="text-base">
            Memindahkan uang antar akun, mis. setoran laci ke kas toko atau setor tunai ke rekening bank.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ok) return;
            transfer.mutate(
              { fromAccountId: fromId, toAccountId: toId, amount, note: note.trim() || null },
              { onSuccess: (t) => onSaved(`Pindah kas ${t.number ?? ''} tersimpan: ${formatRupiah(t.amount)}.`) },
            );
          }}
        >
          <Field label="Dari">
            <AccountChips accounts={accounts} value={fromId} onChange={setFromId} />
          </Field>
          <Field label="Ke">
            <AccountChips accounts={accounts.filter((a) => a.id !== fromId)} value={toId} onChange={setToId} />
          </Field>
          <Field label="Jumlah">
            <MoneyInput value={amount} onChange={setAmount} className="h-11" autoFocus />
          </Field>
          <Field label="Catatan">
            <Input value={note} onChange={(e) => setNote(e.target.value)} className="h-11" maxLength={200} />
          </Field>
          {transfer.error && <Notice tone="error">{transfer.error.message}</Notice>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" className="h-11 px-5" disabled={!ok || transfer.isPending}>
              {transfer.isPending && <Loader2 className="animate-spin" />} Simpan
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CategoriesDialog({ onClose }: { onClose: () => void }) {
  const categories = useCashCategories();
  const save = useSaveCashCategory();
  const [editing, setEditing] = useState<CashCategory | null>(null);
  const [name, setName] = useState('');
  const own = (categories.data ?? []).filter((c) => !c.isSystem);
  const builtIn = (categories.data ?? []).filter((c) => c.isSystem && c.isOperatingExpense);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">Kategori biaya</DialogTitle>
          <DialogDescription className="text-base">
            Biaya operasional ikut mengurangi laba di laporan Laba Rugi.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-lg border">
          {[...builtIn, ...own].map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span>
                {c.name}
                {c.direction === 'IN' && <span className="text-muted-foreground text-sm"> · kas masuk</span>}
              </span>
              {c.isSystem ? (
                <span className="text-muted-foreground text-sm">bawaan</span>
              ) : (
                <Button
                  variant="outline"
                  className="h-9"
                  onClick={() => {
                    setEditing(c);
                    setName(c.name);
                  }}
                >
                  Ubah nama
                </Button>
              )}
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            save.mutate(
              editing
                ? {
                    id: editing.id,
                    name: name.trim(),
                    direction: editing.direction === 'IN' ? 'IN' : 'OUT',
                    isOperatingExpense: editing.isOperatingExpense,
                  }
                : { name: name.trim(), direction: 'OUT', isOperatingExpense: true },
              {
                onSuccess: () => {
                  setEditing(null);
                  setName('');
                },
              },
            );
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={editing ? `Nama baru untuk ${editing.name}` : 'Nama biaya baru, mis. Parkir & retribusi'}
            className="h-11"
            maxLength={60}
          />
          <Button type="submit" className="h-11" disabled={!name.trim() || save.isPending}>
            {editing ? 'Simpan' : 'Tambah'}
          </Button>
        </form>
        {save.error && <Notice tone="error">{save.error.message}</Notice>}
      </DialogContent>
    </Dialog>
  );
}
