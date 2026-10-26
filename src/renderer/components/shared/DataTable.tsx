// Every data table goes through here (frontend-standards §5): TanStack Table v8 for the
// columns, paging done by the server (`page`/`pageSize` query params, `meta.total` back).
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Per-column extras: `align: 'right'` for money & quantities (design-standards §3). */
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- generic names must match the library
  interface ColumnMeta<TData, TValue> {
    align?: 'left' | 'right' | 'center';
    className?: string;
  }
}

interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  getRowId: (row: T) => string;
  /** Server-side paging; omit for a short, unpaged list. */
  paging?: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void };
  isLoading?: boolean;
  /** Shown instead of rows when there is no data. */
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  /** Rows that should look switched off (inactive records). */
  isRowMuted?: (row: T) => boolean;
  className?: string;
}

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export function DataTable<T>({
  columns,
  data,
  getRowId,
  paging,
  isLoading,
  empty,
  onRowClick,
  isRowMuted,
  className,
}: DataTableProps<T>) {
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table v8 is not memo-safe; this component does not memoize it
  const table = useReactTable({
    data,
    columns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  });

  const pages = paging ? Math.max(1, Math.ceil(paging.total / paging.pageSize)) : 1;
  const from = paging && paging.total > 0 ? (paging.page - 1) * paging.pageSize + 1 : 0;
  const to = paging ? Math.min(paging.total, paging.page * paging.pageSize) : data.length;

  return (
    <div className={cn('overflow-hidden rounded-xl border bg-background', className)}>
      <Table className="text-base">
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id} className="bg-surface-muted hover:bg-surface-muted">
              {hg.headers.map((h) => (
                <TableHead
                  key={h.id}
                  // Column widths come from meta.className; the header keeps its own font (twMerge: last wins).
                  className={cn(
                    h.column.columnDef.meta?.className,
                    'text-muted-foreground h-11 px-4 font-sans text-sm font-medium',
                    alignClass[h.column.columnDef.meta?.align ?? 'left'],
                  )}
                >
                  {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {isLoading && data.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-32 text-center">
                <Loader2 className="text-muted-foreground mx-auto size-6 animate-spin" aria-label="Memuat" />
              </TableCell>
            </TableRow>
          ) : data.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length}>
                {empty ?? <p className="text-muted-foreground py-8 text-center">Belum ada data.</p>}
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter') onRowClick(row.original);
                      }
                    : undefined
                }
                className={cn(
                  'hover:bg-surface-muted h-14',
                  onRowClick &&
                    'cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  isRowMuted?.(row.original) && 'text-muted-foreground',
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      'px-4 py-2.5 whitespace-normal',
                      alignClass[cell.column.columnDef.meta?.align ?? 'left'],
                      cell.column.columnDef.meta?.align === 'right' && 'tabular-nums',
                      cell.column.columnDef.meta?.className,
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {paging && paging.total > 0 && (
        <div className="flex items-center justify-between gap-4 border-t px-4 py-3 text-base">
          <span className="text-muted-foreground">
            {formatNumber(String(from))}–{formatNumber(String(to))} dari {formatNumber(String(paging.total))}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="size-11"
              aria-label="Halaman sebelumnya"
              disabled={paging.page <= 1 || isLoading}
              onClick={() => paging.onPageChange(paging.page - 1)}
            >
              <ChevronLeft className="size-5" />
            </Button>
            <span className="min-w-14 text-center tabular-nums" aria-label={`Halaman ${paging.page} dari ${pages}`}>
              {paging.page}/{pages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-11"
              aria-label="Halaman berikutnya"
              disabled={paging.page >= pages || isLoading}
              onClick={() => paging.onPageChange(paging.page + 1)}
            >
              <ChevronRight className="size-5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
