// The ONLY place that knows where things live (desktop-runtime §1). PRD §3.1.
import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const APP_DIR_NAME = 'pos-desktop';

export interface AppPaths {
  dataDir: string;
  pgData: string;
  logDir: string;
  backupDir: string;
  configFile: string;
  secretsFile: string;
  pgBinDir: string;
  migrationsDir: string;
  rendererDir: string;
}

/** PostgreSQL on Windows is unreliable with non-ASCII data paths (PRD §3.1, NFR-COMP-03). */
function hasNonAscii(p: string): boolean {
  return /[^\x20-\x7e]/.test(p);
}

/** Must run before `app.whenReady()` so Electron's own userData lands in the same folder. */
export function configureUserData(): string {
  let dataDir = join(app.getPath('appData'), APP_DIR_NAME);
  if (hasNonAscii(dataDir)) dataDir = join(process.env.ProgramData ?? 'C:\\ProgramData', APP_DIR_NAME);
  app.setPath('userData', dataDir);
  return dataDir;
}

export function resolvePaths(): AppPaths {
  const dataDir = app.getPath('userData');
  const appRoot = app.getAppPath();
  const resources = app.isPackaged ? process.resourcesPath : join(appRoot, 'resources');
  const paths: AppPaths = {
    dataDir,
    pgData: join(dataDir, 'pgdata'),
    logDir: join(dataDir, 'logs'),
    backupDir: join(dataDir, 'backups'),
    configFile: join(dataDir, 'config.json'),
    secretsFile: join(dataDir, 'secrets.bin'),
    pgBinDir: join(resources, 'postgres', 'bin'),
    migrationsDir: app.isPackaged ? join(process.resourcesPath, 'migrations') : join(appRoot, 'db', 'migrations'),
    rendererDir: join(__dirname, '..', 'renderer'),
  };
  for (const dir of [paths.dataDir, paths.logDir, paths.backupDir]) mkdirSync(dir, { recursive: true });
  return paths;
}
