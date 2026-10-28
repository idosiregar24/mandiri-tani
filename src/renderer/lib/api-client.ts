// The only way the UI talks to the server (frontend-standards §2). Same origin in
// production (served by the embedded server), Vite proxy in development.
import { desktopBridge } from './desktop';
import { sessionToken, useSessionStore } from './session';

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

  /** Per-field messages of a 400 VALIDATION_ERROR ("units.0.conversionQty" → message). */
  get fieldErrors(): Record<string, string> {
    const d = this.details as { fieldErrors?: Record<string, string> } | undefined;
    return d?.fieldErrors ?? {};
  }
}

export interface Page<T> {
  data: T[];
  meta: { total: number; page: number; pageSize: number };
}

// The per-start local access key from the main process (sprint-2 S2-1). It is NOT a login: it
// only opens the pre-login routes (setup wizard, login screen) from this PC's own window.
// Outside Electron there is none, so nobody can log in from a plain browser.
let localKey: Promise<string | null> | null = null;
function localAccessKey(): Promise<string | null> {
  localKey ??=
    desktopBridge()
      ?.accessToken()
      .catch(() => null) ?? Promise.resolve(null);
  return localKey;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface SendOptions extends RequestInit {
  /** Pre-login route: send the local access key instead of the session token. */
  hub?: boolean;
}

async function send(
  method: Method,
  path: string,
  body?: unknown,
  init?: SendOptions,
): Promise<{ res: Response; json: unknown }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = init?.hub ? null : sessionToken();
  if (init?.hub) {
    const key = await localAccessKey();
    if (key) headers['X-Local-Access-Key'] = key;
  } else if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      method,
      headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Tidak bisa terhubung ke server toko.');
  }
  if (res.status === 204) return { res, json: null };
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok || !json || typeof json !== 'object' || 'error' in json) {
    const err =
      json && typeof json === 'object' && 'error' in json
        ? (json as { error: { code: string; message: string; details?: unknown } }).error
        : { code: 'HTTP_ERROR', message: `Server menjawab ${res.status}.`, details: undefined };
    // The session ended (idle timeout, logout elsewhere, user deactivated) → back to the login screen.
    if (token && res.status === 401 && err.code === 'UNAUTHENTICATED') {
      useSessionStore.getState().signOut('Sesi berakhir. Silakan masuk lagi.');
    }
    throw new ApiError(res.status, err.code, err.message, err.details);
  }
  return { res, json };
}

export async function apiGet<T>(path: string, init?: SendOptions): Promise<T> {
  return ((await send('GET', path, undefined, init)).json as { data: T }).data;
}

/** GET of a paginated list: keeps `meta` (total, page, pageSize). */
export async function apiGetPage<T>(path: string, init?: RequestInit): Promise<Page<T>> {
  return (await send('GET', path, undefined, init)).json as Page<T>;
}

export async function apiPost<T>(path: string, body: unknown, init?: SendOptions): Promise<T> {
  // 204 No Content (e.g. /auth/logout) has no body.
  return ((await send('POST', path, body, init)).json as { data: T } | null)?.data as T;
}

export async function apiPut<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  return ((await send('PUT', path, body, init)).json as { data: T }).data;
}

export async function apiDelete(path: string, init?: RequestInit): Promise<void> {
  await send('DELETE', path, undefined, init);
}

/** `?q=…&page=…` from an object, skipping empty values. */
export function toQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}
