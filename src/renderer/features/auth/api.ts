import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LoginInput, LoginResult, LoginUserCard } from '@shared/schemas/auth';
import type { SetupInput, SetupStatus } from '@shared/schemas/settings';
import { apiGet, apiPost } from '@/lib/api-client';
import { useSessionStore } from '@/lib/session';

export const authKeys = {
  setupStatus: ['setup', 'status'] as const,
  loginUsers: ['auth', 'login-users'] as const,
};

/** Pre-login routes go with the local access key (`hub: true`), not a session (sprint-2 S2-1). */
export function useSetupStatus() {
  return useQuery({
    queryKey: authKeys.setupStatus,
    queryFn: () => apiGet<SetupStatus>('/setup/status', { hub: true }),
    staleTime: Infinity,
  });
}

export function useLoginUsers(enabled: boolean) {
  return useQuery({
    queryKey: authKeys.loginUsers,
    queryFn: () => apiGet<LoginUserCard[]>('/auth/login-users', { hub: true }),
    enabled,
  });
}

export function useLogin() {
  const signIn = useSessionStore((s) => s.signIn);
  return useMutation({
    mutationFn: (input: LoginInput) => apiPost<LoginResult>('/auth/login', input, { hub: true }),
    onSuccess: signIn,
  });
}

export function useSetup() {
  const qc = useQueryClient();
  const signIn = useSessionStore((s) => s.signIn);
  return useMutation({
    mutationFn: (input: SetupInput) => apiPost<LoginResult>('/setup', input, { hub: true }),
    onSuccess: (result) => {
      qc.setQueryData<SetupStatus>(authKeys.setupStatus, (s) => (s ? { ...s, needsSetup: false } : s));
      signIn(result);
    },
  });
}

/** Ends the session on the server, then forgets every cached server response. */
export function useLogout() {
  const qc = useQueryClient();
  const signOut = useSessionStore((s) => s.signOut);
  return useMutation({
    mutationFn: () => apiPost<null>('/auth/logout', undefined),
    onSettled: () => {
      signOut();
      qc.clear();
    },
  });
}
