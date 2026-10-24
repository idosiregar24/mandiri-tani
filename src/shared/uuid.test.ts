import { describe, expect, it } from 'vitest';
import { UUID_RE, uuidv7 } from './uuid';

describe('uuidv7', () => {
  it('produces RFC 9562 version-7 ids', () => {
    const id = uuidv7();
    expect(id).toMatch(UUID_RE);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('encodes the timestamp in the first 48 bits', () => {
    const ms = Date.UTC(2026, 9, 24, 12, 0, 0);
    const id = uuidv7(ms);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(ms);
  });

  it('sorts in creation order, even within the same millisecond', () => {
    const ms = Date.now();
    const ids = Array.from({ length: 200 }, () => uuidv7(ms));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
