// Small helpers shared by route handlers.
import type { Response } from 'express';
import { Uuid } from '@shared/schemas/common';
import { AppError } from './errors';

/** `:id` route params must be UUIDs — anything else is a 404, not a database error. */
export function parseId(value: unknown, what = 'Data'): string {
  const r = Uuid.safeParse(value);
  if (!r.success) throw new AppError('NOT_FOUND', `${what} tidak ditemukan.`, 404);
  return r.data;
}

export function sendPage<T>(res: Response, page: { rows: T[]; total: number; page: number; pageSize: number }): void {
  res.json({ data: page.rows, meta: { total: page.total, page: page.page, pageSize: page.pageSize } });
}

/** Escapes LIKE wildcards so a search for "50%" matches literally. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
