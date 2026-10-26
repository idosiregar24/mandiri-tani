// Domain error with a stable machine code and a Bahasa Indonesia message
// (backend-standards §3). Thrown by services, mapped to JSON by errorHandler.
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 422,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** PostgreSQL unique violation (23505), optionally on one specific index/constraint. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; constraint?: string };
  return e.code === '23505' && (constraint === undefined || e.constraint === constraint);
}

export const notFoundError = (what: string) => new AppError('NOT_FOUND', `${what} tidak ditemukan.`, 404);
