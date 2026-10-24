// Database passwords, encrypted with Windows DPAPI via Electron safeStorage
// (security-standards §6). Never logged, never in env files or source.
import { safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { generatePassword } from './pg/PgManager';

export interface DbSecrets {
  superuserPassword: string;
  appPassword: string;
}

export class SecretsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretsError';
  }
}

export function loadSecrets(file: string): DbSecrets | null {
  if (!existsSync(file)) return null;
  if (!safeStorage.isEncryptionAvailable()) throw new SecretsError('Enkripsi Windows (DPAPI) tidak tersedia.');
  try {
    const parsed = JSON.parse(safeStorage.decryptString(readFileSync(file))) as Partial<DbSecrets>;
    if (!parsed.superuserPassword || !parsed.appPassword) throw new Error('incomplete');
    return { superuserPassword: parsed.superuserPassword, appPassword: parsed.appPassword };
  } catch {
    throw new SecretsError(
      'Kunci database tidak bisa dibuka (file rahasia rusak atau akun Windows berbeda). Pulihkan dari backup atau hubungi admin.',
    );
  }
}

/** Only for a brand-new cluster: creating new passwords for an existing one would lock us out. */
export function createSecrets(file: string): DbSecrets {
  if (!safeStorage.isEncryptionAvailable()) throw new SecretsError('Enkripsi Windows (DPAPI) tidak tersedia.');
  const secrets: DbSecrets = { superuserPassword: generatePassword(), appPassword: generatePassword() };
  writeFileSync(file, safeStorage.encryptString(JSON.stringify(secrets)), { mode: 0o600 });
  return secrets;
}
