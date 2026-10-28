import type { Request, Response } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { setClock } from './clock';
import { rateLimit } from './rate-limit';

afterEach(() => setClock());

function hit(mw: ReturnType<typeof rateLimit>, ip: string): { ok: boolean; retryAfter?: string; error?: unknown } {
  const headers: Record<string, string> = {};
  const res = { setHeader: (k: string, v: string) => (headers[k] = v) } as unknown as Response;
  try {
    let passed = false;
    mw({ ip } as Request, res, () => (passed = true));
    return { ok: passed };
  } catch (error) {
    return { ok: false, retryAfter: headers['Retry-After'], error };
  }
}

describe('rateLimit', () => {
  it('allows `limit` requests per window per key, then answers 429 with Retry-After', () => {
    let t = Date.parse('2026-10-29T08:00:00Z');
    setClock(() => new Date(t));
    const mw = rateLimit({ limit: 3, windowMs: 60_000, key: (req) => req.ip ?? null });
    expect([1, 2, 3].map(() => hit(mw, 'a').ok)).toEqual([true, true, true]);
    const blocked = hit(mw, 'a');
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBe('60');
    expect(blocked.error).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(hit(mw, 'b').ok).toBe(true); // other keys are independent

    t += 30_000;
    expect(hit(mw, 'a').ok).toBe(false);
    t += 30_001; // the window slides: the first three hits have expired
    expect(hit(mw, 'a').ok).toBe(true);
  });

  it('skips requests whose key is null', () => {
    const mw = rateLimit({ limit: 1, windowMs: 60_000, key: () => null });
    expect(hit(mw, 'a').ok).toBe(true);
    expect(hit(mw, 'a').ok).toBe(true);
  });
});
