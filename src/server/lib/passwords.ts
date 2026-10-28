// Password & PIN hashing (security-standards §1): argon2id via @node-rs/argon2 (N-API, safe in
// Electron). Parameters are the OWASP minimum for argon2id — m = 19 MiB, t = 2, p = 1 — and are
// encoded in every hash string, so they can be raised later without breaking old hashes.
import { hash, verify } from '@node-rs/argon2';

// Algorithm.Argon2id is a const enum, which isolatedModules cannot import; it is also the default.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashSecret(secret: string): Promise<string> {
  return hash(secret, OPTIONS);
}

/** False for a wrong secret or a malformed hash — never throws on bad input. */
export async function verifySecret(hashed: string, secret: string): Promise<boolean> {
  try {
    return await verify(hashed, secret);
  } catch {
    return false;
  }
}

// Verified when the username does not exist, so a wrong username takes as long as a wrong PIN.
let dummy: Promise<string> | null = null;
export async function burnVerify(secret: string): Promise<void> {
  dummy ??= hashSecret('mandiri-tani-dummy-secret');
  await verifySecret(await dummy, secret);
}
