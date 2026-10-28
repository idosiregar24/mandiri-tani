import { describe, expect, it } from 'vitest';
import { hashSecret, verifySecret } from './passwords';

describe('passwords (argon2id)', () => {
  it('hashes with argon2id at the OWASP minimum and verifies', async () => {
    const h = await hashSecret('135790');
    expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifySecret(h, '135790')).toBe(true);
    expect(await verifySecret(h, '135791')).toBe(false);
  });

  it('salts every hash and never throws on a malformed hash', async () => {
    expect(await hashSecret('sama')).not.toBe(await hashSecret('sama'));
    expect(await verifySecret('bukan-hash', 'x')).toBe(false);
  });
});
