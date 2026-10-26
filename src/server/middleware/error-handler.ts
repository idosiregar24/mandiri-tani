import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, type ErrorBody } from '../lib/errors';

export const notFound: RequestHandler = (req, res) => {
  const body: ErrorBody = {
    error: { code: 'NOT_FOUND', message: `Alamat ${req.method} ${req.path} tidak ditemukan.` },
  };
  res.status(404).json(body);
};

/** Maps every error to the contract in backend-standards §3. Never leaks stack traces. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let body: ErrorBody = {
    error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan di server. Coba lagi atau hubungi admin.' },
  };

  if (err instanceof AppError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message, details: err.details } };
  } else if (err instanceof ZodError) {
    status = 400;
    // fieldErrors: "units.0.conversionQty" → message, mapped onto form fields by the renderer.
    const fieldErrors: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.map(String).join('.');
      fieldErrors[key] ??= issue.message;
    }
    const first = err.issues[0]?.message;
    body = {
      error: {
        code: 'VALIDATION_ERROR',
        message: first ? `Data belum benar: ${first}` : 'Data yang dikirim tidak valid.',
        details: { fieldErrors, issues: err.issues },
      },
    };
  } else if (typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.parse.failed') {
    status = 400;
    body = { error: { code: 'INVALID_JSON', message: 'Format data tidak valid (JSON rusak).' } };
  } else if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = String((err as { code: unknown }).code);
    if (code === '23505') {
      status = 409;
      body = { error: { code: 'DUPLICATE', message: 'Data yang sama sudah ada.' } };
    } else if (code === '23514') {
      status = 422;
      body = {
        error: { code: 'INVALID_DATA', message: 'Data tidak memenuhi aturan (angka minus atau isian tidak sesuai).' },
      };
    } else if (code === '23503') {
      status = 409;
      body = { error: { code: 'REFERENCE_IN_USE', message: 'Data masih dipakai oleh data lain.' } };
    } else if (code === 'ECONNREFUSED' || code === '57P01' || code === '57P03') {
      status = 503;
      body = {
        error: { code: 'DB_UNAVAILABLE', message: 'Database sedang tidak tersedia. Tunggu sebentar lalu coba lagi.' },
      };
    }
  }

  if (status >= 500) req.log?.error({ err }, 'request failed');
  res.status(status).json(body);
};
