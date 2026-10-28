// User accounts (PRD FR-SYS-02, sprint-2 S2-2). The same schemas validate the server request and
// the renderer form.
import { ROLES } from '../permissions';
import { Password, Pin } from './auth';
import { RequiredText, z } from './common';

export const Username = z
  .string()
  .trim()
  .min(3, 'Username minimal 3 huruf.')
  .max(30, 'Username maksimal 30 huruf.')
  .regex(/^[a-zA-Z0-9._-]+$/, 'Username hanya huruf, angka, titik, garis bawah atau tanda minus (tanpa spasi).')
  .transform((v) => v.toLowerCase());

const pinTwice = <T extends { pin?: string | null; pinConfirm?: string | null }>(v: T) => v.pin === v.pinConfirm;

/** The first Owner, created by the setup wizard: password AND PIN are required (S2-2). */
export const OwnerAccountInput = z
  .object({
    fullName: RequiredText('Nama', 100),
    username: Username,
    password: Password,
    pin: Pin,
    pinConfirm: z.string(),
  })
  .refine(pinTwice, { message: 'PIN kedua tidak sama.', path: ['pinConfirm'] });
export type OwnerAccountInput = z.infer<typeof OwnerAccountInput>;

export const UserCreateInput = z
  .object({
    fullName: RequiredText('Nama', 100),
    username: Username,
    role: z.enum(ROLES),
    password: Password.nullish().transform((v) => v || null),
    pin: Pin,
    pinConfirm: z.string(),
  })
  .refine(pinTwice, { message: 'PIN kedua tidak sama.', path: ['pinConfirm'] })
  .refine((v) => v.role !== 'OWNER' || v.password !== null, {
    message: 'Owner wajib punya password.',
    path: ['password'],
  });
export type UserCreateInput = z.infer<typeof UserCreateInput>;

export const UserUpdateInput = z.object({
  fullName: RequiredText('Nama', 100),
  role: z.enum(ROLES),
});
export type UserUpdateInput = z.infer<typeof UserUpdateInput>;

export const SetPinInput = z
  .object({ pin: Pin, pinConfirm: z.string() })
  .refine(pinTwice, { message: 'PIN kedua tidak sama.', path: ['pinConfirm'] });
export type SetPinInput = z.infer<typeof SetPinInput>;

export const SetPasswordInput = z.object({ password: Password });
export type SetPasswordInput = z.infer<typeof SetPasswordInput>;
