// Piutang / Hutang (sprint-9 B1/B2): open balance per customer or supplier with aging buckets
// (FR-ARAP-05), due filters (FR-ARAP-04), a party's open notes + payments, and opening balances.
import type { ColumnDef } from '@tanstack/react-table';
import { AlarmClock, CalendarClock, Loader2, Plus, Search, Wallet } from 'lucide-react';
import { useState } from 'react';
import type { AgingRow, DueFilter } from '@shared/schemas/ar-ap';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { Notice } from '@/components/shared/Notice';
import { PageHeader } from '@/components/shared/PageHeader';
import { SearchBox } from '@/components/shared/SearchBox';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
import { StatCard } from '@/components/shared/StatCard';
import { StatusPill } from '@/components/shared/StatusPill';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { SIDE, type Side, useAddOpening, useAging, useOpenDocs, usePartyPayments } from '@/features/ar-ap/api';
import { PartyPaymentDialog } from '@/features/ar-ap/PartyPaymentDialog';
import { usePartners } from '@/features/partners/api';
import { todayJakarta } from '@/features/pos/api';
import { ApiError } from '@/lib/api-client';
import { formatNumber, formatRupiah } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks';
import { cn } from '@/lib/utils';

const date = (iso: string) => iso.split('-').reverse().join('/');
const money = (v: string) => (v === '0.00' ? '—' : formatRupiah(v));

const DUE_OPTIONS = [
  { value: 'all', label: 'Semua' },
  { value: 'overdue', label: 'Lewat jatuh tempo' },
  { value: 'week', label: 'Jatuh tempo 7 hari' },
] as const;

const bucket = (
  header: string,
  key: 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90plus',
): ColumnDef<AgingRow, unknown> => ({
  header,
  cell: ({ row }) => (
    <span className={cn('whitespace-nowrap', key !== 'current' && row.original[key] !== '0.00' && 'text-error-ink')}>
      {money(row.original[key])}
    </span>
  ),
  meta: { align: 'right', className: 'whitespace-nowrap' },
});

const columns = (side: Side): ColumnDef<AgingRow, unknown>[] => [
  {
    header: SIDE[side].party,
    cell: ({ row }) => (
      <div>
        <p className="font-medium">{row.original.name}</p>
        <p className="text-muted-foreground text-sm">
          {row.original.code}
          {row.original.phone && ` · ${row.original.phone}`}
        </p>
      </div>
    ),
    meta: { className: 'min-w-48' },
  },
  {
    header: 'Nota',
    cell: ({ row }) => formatNumber(String(row.original.docCount)),
    meta: { align: 'right', className: 'w-16' },
  },
  {
    header: 'Sisa',
    cell: ({ row }) => <span className="font-semibold whitespace-nowrap">{formatRupiah(row.original.open)}</span>,
    meta: { align: 'right', className: 'whitespace-nowrap' },
  },
  bucket('Belum jatuh tempo', 'current'),
  bucket('1–30 hari', 'd1_30'),
  bucket('31–60 hari', 'd31_60'),
  bucket('61–90 hari', 'd61_90'),
  bucket('> 90 hari', 'd90plus'),
  {
    header: 'Jatuh tempo terlama',
    cell: ({ row }) => {
      const late = row.original.oldestDue < todayJakarta();
      return (
        <StatusPill tone={late ? 'error' : row.original.oldestDue === todayJakarta() ? 'warning' : 'neutral'}>
          {date(row.original.oldestDue)}
        </StatusPill>
      );
    },
    meta: { className: 'w-36' },
  },
];

export function AgingPage({ side }: { side: Side }) {
  const words = SIDE[side];
  const [q, setQ] = useState('');
  const [due, setDue] = useState<DueFilter>('all');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AgingRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const debounced = useDebouncedValue(q.trim(), 250);
  const list = useAging(side, { q: debounced || undefined, due, page });
  const totals = list.data?.meta.totals;

  return (
    <div className="space-y-6">
      <PageHeader
        title={words.open}
        count={list.data ? formatNumber(String(list.data.meta.total)) : undefined}
        description={
          side === 'AR'
            ? 'Pelanggan yang masih punya nota belum lunas, dengan umur piutangnya.'
            : 'Faktur supplier yang belum dibayar, dengan umur hutangnya.'
        }
        actions={
          <Button size="lg" className="h-11 text-base" onClick={() => setAdding(true)}>
            <Plus /> {side === 'AR' ? 'Saldo awal piutang' : 'Hutang manual'}
          </Button>
        }
      />
      {saved && <Notice tone="success">{saved}</Notice>}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label={`Total ${words.open.toLowerCase()}`}
          icon={Wallet}
          value={totals ? formatRupiah(totals.open) : '…'}
          hint={
            totals &&
            `${formatNumber(String(totals.docs))} nota · ${formatNumber(String(totals.parties))} ${words.party.toLowerCase()}`
          }
        />
        <StatCard
          label="Lewat jatuh tempo"
          icon={AlarmClock}
          value={totals ? `${formatNumber(String(totals.overdueDocs))} nota` : '…'}
          hint={totals && formatRupiah(totals.overdue)}
        />
        <StatCard
          label="Jatuh tempo 7 hari"
          icon={CalendarClock}
          value={totals ? `${formatNumber(String(totals.dueWeekDocs))} nota` : '…'}
          hint={totals && `${formatNumber(String(totals.dueTodayDocs))} jatuh tempo hari ini`}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="Jatuh tempo"
          value={due}
          onChange={(v) => {
            setDue(v);
            setPage(1);
          }}
          options={DUE_OPTIONS}
        />
        <SearchBox
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder={`Cari nama atau kode ${words.party.toLowerCase()}`}
        />
      </div>
      {list.isError && <Notice tone="error">{list.error.message}</Notice>}
      <DataTable
        columns={columns(side)}
        data={list.data?.data ?? []}
        getRowId={(r) => r.partyId}
        isLoading={list.isFetching}
        onRowClick={setOpen}
        paging={
          list.data && { page, pageSize: list.data.meta.pageSize, total: list.data.meta.total, onPageChange: setPage }
        }
        empty={<EmptyState icon={Wallet} title={`Tidak ada ${words.open.toLowerCase()} yang belum lunas`} />}
      />
      {open && <PartyDetail side={side} row={open} onClose={() => setOpen(null)} />}
      {adding && (
        <OpeningDialog
          side={side}
          onClose={() => setAdding(false)}
          onSaved={(msg) => {
            setAdding(false);
            setSaved(msg);
          }}
        />
      )}
    </div>
  );
}

function PartyDetail({ side, row, onClose }: { side: Side; row: AgingRow; onClose: () => void }) {
  const words = SIDE[side];
  const docs = useOpenDocs(side, row.partyId);
  const payments = usePartyPayments(side, row.partyId);
  const [paying, setPaying] = useState(false);
  if (paying) {
    return (
      <PartyPaymentDialog side={side} party={{ id: row.partyId, name: row.name }} onClose={() => setPaying(false)} />
    );
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{row.name}</DialogTitle>
          <DialogDescription className="text-base">{words.open} belum lunas dan pembayaran terakhir.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[40vh] overflow-y-auto rounded-lg border">
          {docs.isPending ? (
            <p className="text-muted-foreground flex items-center gap-2 p-4">
              <Loader2 className="size-4 animate-spin" /> Memuat…
            </p>
          ) : (docs.data ?? []).length === 0 ? (
            <p className="text-muted-foreground p-4">Semua nota sudah lunas.</p>
          ) : (
            <ul>
              {docs.data!.map((d) => (
                <li key={d.id} className="flex min-h-12 items-center gap-3 border-b px-4 py-2 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono font-medium">{d.docNumber}</p>
                    <p className="text-muted-foreground text-sm">
                      {date(d.docDate)} · jatuh tempo {date(d.dueDate)}
                      {d.sourceType === 'OPENING' && ' · saldo awal'}
                    </p>
                  </div>
                  {d.daysOverdue > 0 && <StatusPill tone="error">lewat {d.daysOverdue} hari</StatusPill>}
                  <span className="w-36 text-right font-semibold tabular-nums">{formatRupiah(d.open)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {(payments.data ?? []).length > 0 && (
          <div className="space-y-2">
            <p className="font-semibold">Pembayaran terakhir</p>
            <ul className="rounded-lg border">
              {payments.data!.slice(0, 5).map((p) => (
                <li key={p.id} className="flex items-center justify-between border-b px-4 py-2 last:border-b-0">
                  <span className="font-mono">{p.number}</span>
                  <span className="text-muted-foreground text-sm">
                    {new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium' }).format(
                      new Date(p.paidAt),
                    )}{' '}
                    · {p.methodName} · {p.docCount} nota
                  </span>
                  <span className="tabular-nums">{formatRupiah(p.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-11" onClick={onClose}>
            Tutup
          </Button>
          <Button className="h-11 px-5" disabled={(docs.data ?? []).length === 0} onClick={() => setPaying(true)}>
            <Wallet /> {words.pay}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** FR-ARAP-06: an old note (go-live) or a supplier debt outside iPOS, per document. */
function OpeningDialog({
  side,
  onClose,
  onSaved,
}: {
  side: Side;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const words = SIDE[side];
  const [party, setParty] = useState<{ id: string; name: string } | null>(null);
  const [q, setQ] = useState('');
  const debounced = useDebouncedValue(q.trim(), 200);
  const found = usePartners(side === 'AR' ? 'customers' : 'suppliers', { q: debounced || undefined, page: 1 });
  const choices = (found.data?.data ?? []).filter((p) => !('isWalkIn' in p && p.isWalkIn)).slice(0, 8);
  const [docNumber, setDocNumber] = useState('');
  const [docDate, setDocDate] = useState(todayJakarta());
  const [dueDate, setDueDate] = useState(todayJakarta());
  const [amount, setAmount] = useState('');
  const add = useAddOpening(side);
  const ok = party && docNumber.trim() && docDate && dueDate && amount !== '' && amount !== '0';

  const submit = () => {
    if (!ok || !party) return;
    const base = { docNumber: docNumber.trim(), docDate, dueDate, amount };
    add.mutate(side === 'AR' ? { customerId: party.id, ...base } : { supplierId: party.id, ...base }, {
      onSuccess: (d) => onSaved(`${words.open} ${d.docNumber} untuk ${party.name} tersimpan: ${formatRupiah(d.open)}.`),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">{side === 'AR' ? 'Saldo awal piutang' : 'Hutang manual'}</DialogTitle>
          <DialogDescription className="text-base">
            Catat satu nota yang belum lunas: nomor, tanggal, jatuh tempo, dan <b>sisa</b> yang masih harus dibayar.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <span className="font-medium">{words.party}</span>
            {party ? (
              <div className="flex h-11 items-center justify-between rounded-md border px-3">
                <span className="font-medium">{party.name}</span>
                <button type="button" className="text-primary text-sm font-medium" onClick={() => setParty(null)}>
                  Ganti
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                  <Input
                    autoFocus
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={`Cari ${words.party.toLowerCase()}`}
                    className="h-11 pl-9"
                  />
                </div>
                <ul className="max-h-48 overflow-y-auto rounded-md border">
                  {choices.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="hover:bg-tani-green-light w-full px-3 py-2 text-left"
                        onClick={() => setParty({ id: c.id, name: c.name })}
                      >
                        {c.name} <span className="text-muted-foreground text-sm">{c.code}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <label className="block space-y-1.5">
            <span className="font-medium">Nomor nota</span>
            <Input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} className="h-11" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className="font-medium">Tanggal nota</span>
              <Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} className="h-11" />
            </label>
            <label className="space-y-1.5">
              <span className="font-medium">Jatuh tempo</span>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-11" />
            </label>
          </div>
          <label className="block space-y-1.5">
            <span className="font-medium">Sisa yang belum dibayar</span>
            <MoneyInput value={amount} onChange={setAmount} className="h-11" />
          </label>
          {add.error && (
            <Notice tone="error">{add.error instanceof ApiError ? add.error.message : 'Gagal menyimpan.'}</Notice>
          )}
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
