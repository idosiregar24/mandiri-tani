// One small master list (units, categories, …) with an add/edit dialog and a guarded delete.
// Config-driven so the six "Data Lain" tabs look and behave the same; validation is always
// the shared Zod schema for that master (frontend-standards §4).
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm, type FieldValues, type Path } from 'react-hook-form';
import type { z } from 'zod';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DataTable } from '@/components/shared/DataTable';
import { Notice } from '@/components/shared/Notice';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { applyServerErrors } from '@/lib/form-errors';
import { cn } from '@/lib/utils';
import { useMasterList, useRemoveMaster, useSaveMaster, type MasterResource } from './api';

const NONE = '__none__';

export interface MasterField {
  name: string;
  label: string;
  kind: 'text' | 'code' | 'number' | 'checkbox' | 'select';
  required?: boolean;
  hint?: string;
  /** `kind: 'select'`: choices; `null` value = "none" option labelled `emptyLabel`. */
  options?: { value: string; label: string }[];
  emptyLabel?: string;
}

export interface MasterSectionConfig<T extends { id: string }> {
  resource: MasterResource;
  title: string;
  /** Singular noun for buttons and dialogs: "Satuan", "Kategori". */
  noun: string;
  columns: ColumnDef<T, unknown>[];
  /** Schema + fields for this row (built-in rows may allow fewer fields). */
  schema: (row: T | null) => z.ZodType<FieldValues, FieldValues>;
  fields: (row: T | null) => MasterField[];
  defaults: (row: T | null) => FieldValues;
  /** Label for the delete confirmation; null = this row cannot be deleted. */
  deleteName?: (row: T) => string | null;
  description?: string;
}

export function MasterSection<T extends { id: string }>({
  config,
  canWrite,
}: {
  config: MasterSectionConfig<T>;
  canWrite: boolean;
}) {
  const list = useMasterList(config.resource);
  const [editing, setEditing] = useState<T | 'new' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const rows = (list.data ?? []) as unknown as T[];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{config.title}</h2>
          {config.description && <p className="text-muted-foreground text-base">{config.description}</p>}
        </div>
        {canWrite && (
          <Button variant="outline" className="h-11 text-base" onClick={() => setEditing('new')}>
            <Plus /> Tambah {config.noun}
          </Button>
        )}
      </div>
      {message && <Notice tone="success">{message}</Notice>}
      {list.isError && <Notice tone="error">{list.error.message}</Notice>}
      <DataTable
        columns={config.columns}
        data={rows}
        getRowId={(r) => r.id}
        isLoading={list.isFetching}
        onRowClick={canWrite ? (r) => setEditing(r) : undefined}
      />
      {editing && (
        <MasterDialog
          config={config}
          row={editing === 'new' ? null : editing}
          onClose={(msg) => {
            setEditing(null);
            setMessage(msg ?? null);
          }}
        />
      )}
    </section>
  );
}

function MasterDialog<T extends { id: string }>({
  config,
  row,
  onClose,
}: {
  config: MasterSectionConfig<T>;
  row: T | null;
  onClose: (message?: string) => void;
}) {
  const save = useSaveMaster(config.resource);
  const remove = useRemoveMaster(config.resource);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const form = useForm<FieldValues>({ resolver: zodResolver(config.schema(row)), defaultValues: config.defaults(row) });
  const deleteName = row && config.deleteName ? config.deleteName(row) : null;

  const onSubmit = form.handleSubmit(async (input) => {
    setError(null);
    try {
      await save.mutateAsync({ id: row?.id, input });
      onClose(`${config.noun} tersimpan.`);
    } catch (err) {
      setError(applyServerErrors(form.setError, err));
    }
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <Form {...form}>
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
            <DialogHeader>
              <DialogTitle className="text-xl">{row ? `Ubah ${config.noun}` : `Tambah ${config.noun}`}</DialogTitle>
            </DialogHeader>
            {error && <Notice tone="error">{error}</Notice>}
            {config.fields(row).map((f, i) => (
              <FormField
                key={f.name}
                control={form.control}
                name={f.name as Path<FieldValues>}
                render={({ field }) =>
                  f.kind === 'checkbox' ? (
                    <label className="flex items-center gap-2 text-base">
                      <Checkbox
                        checked={Boolean(field.value)}
                        onCheckedChange={(v) => field.onChange(v === true)}
                        className="size-5"
                      />
                      {f.label}
                    </label>
                  ) : (
                    <FormItem>
                      <FormLabel required={f.required} className="text-base">
                        {f.label}
                      </FormLabel>
                      {f.kind === 'select' ? (
                        <Select
                          value={(field.value as string | null) ?? NONE}
                          onValueChange={(v) => field.onChange(v === NONE ? null : v)}
                        >
                          <FormControl>
                            <SelectTrigger className="h-11 w-full text-base">
                              <SelectValue placeholder="Pilih…" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {f.emptyLabel && (
                              <SelectItem value={NONE} className="text-base">
                                {f.emptyLabel}
                              </SelectItem>
                            )}
                            {f.options?.map((o) => (
                              <SelectItem key={o.value} value={o.value} className="text-base">
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <FormControl>
                          <Input
                            {...field}
                            value={(field.value as string | number | null) ?? ''}
                            autoFocus={i === 0}
                            inputMode={f.kind === 'number' ? 'decimal' : undefined}
                            className={cn('h-11 text-base md:text-base', f.kind === 'code' && 'font-mono uppercase')}
                          />
                        </FormControl>
                      )}
                      {f.hint && <p className="text-muted-foreground text-sm">{f.hint}</p>}
                      <FormMessage className="text-base" />
                    </FormItem>
                  )
                }
              />
            ))}
            <DialogFooter className="sm:justify-between">
              <div>
                {deleteName && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-error-ink h-11 text-base"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 /> Hapus
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="h-11 text-base" onClick={() => onClose()}>
                  Batal
                </Button>
                <Button type="submit" className="h-11 text-base" disabled={save.isPending}>
                  {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Simpan
                </Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
      {row && deleteName && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          tone="danger"
          title={`Hapus ${config.noun.toLowerCase()} "${deleteName}"?`}
          description="Data yang masih dipakai tidak bisa dihapus."
          confirmLabel="Hapus"
          pending={remove.isPending}
          onConfirm={() =>
            remove.mutate(row.id, {
              onSuccess: () => onClose(`${config.noun} "${deleteName}" dihapus.`),
              onError: (err) => {
                setConfirmDelete(false);
                setError(err.message);
              },
            })
          }
        />
      )}
    </Dialog>
  );
}
