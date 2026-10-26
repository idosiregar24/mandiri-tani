// The only way the UI talks to the server (frontend-standards §2). Same origin in
// production (served by the embedded server), Vite proxy in development.
import { desktopBridge } from './desktop';

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

// Sprint-3 decision S3-1: until Sprint 2 logins, the desktop window authenticates with the
// per-start local access key from the main process. Outside Electron there is none → 401.
let token: Promise<string | null> | null = null;
function accessToken(): Promise<string | null> {
  token ??=
    desktopBridge()
      ?.accessToken()
      .catch(() => null) ?? Promise.resolve(null);
  return token;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

async function send(
  method: Method,
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<{ res: Response; json: unknown }> {
  const key = await accessToken();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
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
    throw new ApiError(res.status, err.code, err.message, err.details);
  }
  return { res, json };
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  return ((await send('GET', path, undefined, init)).json as { data: T }).data;
}

/** GET of a paginated list: keeps `meta` (total, page, pageSize). */
export async function apiGetPage<T>(path: string, init?: RequestInit): Promise<Page<T>> {
  return (await send('GET', path, undefined, init)).json as Page<T>;
}

export async function apiPost<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  return ((await send('POST', path, body, init)).json as { data: T }).data;
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
