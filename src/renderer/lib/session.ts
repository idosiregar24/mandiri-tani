import { create } from 'zustand';
import { hasPermission, type Permission, type Role } from '@shared/permissions';
import type { LoginResult } from '@shared/schemas/auth';

/**
 * The logged-in session (sprint-2 D1). Kept in memory only — never localStorage — so closing the
 * app always ends it. Menus only hide what the role may not use; the server is the guard
 * (security-standards §2).
 */
interface SessionState {
  session: LoginResult | null;
  /** Shown on the login screen after an automatic sign-out ("Sesi berakhir…"). */
  notice: string | null;
  signIn: (session: LoginResult) => void;
  signOut: (notice?: string) => void;
}

export const useSessionStore = create<SessionState>()((set) => ({
  session: null,
  notice: null,
  signIn: (session) => set({ session, notice: null }),
  signOut: (notice) => set({ session: null, notice: notice ?? null }),
}));

export const sessionToken = (): string | null => useSessionStore.getState().session?.token ?? null;

export function useSessionUser() {
  return useSessionStore((s) => s.session?.user ?? null);
}

/** The session's role; least privilege while nobody is logged in. */
export function useRole(): Role {
  return useSessionStore((s) => s.session?.user.role ?? 'KASIR');
}

export function useCan(permission: Permission): boolean {
  return hasPermission(useRole(), permission);
}

export const ROLE_LABELS: Record<Role, string> = { OWNER: 'Pemilik', KASIR: 'Kasir' };
