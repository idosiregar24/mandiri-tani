import { hasPermission, type Permission, type Role } from '@shared/permissions';

/**
 * Sprint-3 decision S3-1: until Sprint 2 logins, the desktop window acts through the local
 * access key, which the server treats as OWNER. Sprint 2 replaces this with the session's role.
 * Menus only hide what the role may not use — the server is the guard (security-standards §2).
 */
export function useRole(): Role {
  return 'OWNER';
}

export function useCan(permission: Permission): boolean {
  return hasPermission(useRole(), permission);
}
