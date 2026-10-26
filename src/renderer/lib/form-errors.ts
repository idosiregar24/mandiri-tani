import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api-client';

/**
 * Puts a failed save on screen: 400 fieldErrors onto their form fields, anything else as
 * one message for a Notice (frontend-standards §4). Returns that message, or null.
 */
export function applyServerErrors<T extends FieldValues>(setError: UseFormSetError<T>, err: unknown): string | null {
  if (err instanceof ApiError) {
    const fields = Object.entries(err.fieldErrors);
    if (fields.length) {
      for (const [name, message] of fields) setError(name as Path<T>, { message });
      return null;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : 'Gagal menyimpan.';
}
