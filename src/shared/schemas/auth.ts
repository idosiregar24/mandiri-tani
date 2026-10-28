// Login, session and Owner-PIN authorization (PRD FR-SYS-03, FR-POS-20; sprint-2 S2-2, S2-6).
import { OWNER_AUTHORIZABLE, PERMISSIONS, type Permission, type Role } from '../permissions';
import { RequiredText, z } from './common';

export const LOGIN_METHODS = ['PIN', 'PASSWORD'] as const;
export type LoginMethod = (typeof LOGIN_METHODS)[number];

/** PIN = exactly 6 digits (security-standards §1). Used when a PIN is SET, not when logging in. */
export const Pin = z.string().regex(/^\d{6}$/, 'PIN harus 6 angka.');
export const Password = z.string().min(8, 'Password minimal 8 huruf.').max(200, 'Password terlalu panjang.');

// Login secrets are not checked against the PIN/password rules: a wrong-shaped secret is just a
// wrong secret, and the reply must not hint at the rules (generic message, S2-4).
const Secret = z.string().min(1, 'Isi PIN atau password.').max(200);

export const LoginInput = z.object({
  username: RequiredText('Username', 50),
  method: z.enum(LOGIN_METHODS),
  secret: Secret,
});
export type LoginInput = z.infer<typeof LoginInput>;

export const AuthorizeInput = z.object({
  username: RequiredText('Username Owner', 50),
  pin: Secret,
  permission: z.enum(PERMISSIONS).refine((p) => OWNER_AUTHORIZABLE.includes(p), 'Aksi ini tidak memakai otorisasi.'),
});
export type AuthorizeInput = z.infer<typeof AuthorizeInput>;

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
}

export interface LoginResult {
  token: string;
  expiresAt: string;
  method: LoginMethod;
  user: SessionUser;
}

/** A user shown as a card on the hub's login screen (S2-5). */
export interface LoginUserCard {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  methods: LoginMethod[];
}

export interface AuthorizationGrantResult {
  grant: string;
  permission: Permission;
  expiresAt: string;
  grantedBy: { id: string; fullName: string };
}
