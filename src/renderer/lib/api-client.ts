// The only way the UI talks to the server (frontend-standards §2). Same origin in
// production (served by the embedded server), Vite proxy in development.
const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers: { Accept: 'application/json', ...init?.headers } });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Tidak bisa terhubung ke server toko.');
  }
  const body = (await res.json().catch(() => null)) as
    | { data: T }
    | { error: { code: string; message: string; details?: unknown } }
    | null;
  if (!res.ok || !body || 'error' in body) {
    const err = body && 'error' in body ? body.error : { code: 'HTTP_ERROR', message: `Server menjawab ${res.status}.` };
    throw new ApiError(res.status, err.code, err.message, 'details' in err ? err.details : undefined);
  }
  return body.data;
}
