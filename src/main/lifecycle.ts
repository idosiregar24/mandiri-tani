// Boot / shutdown state machine (PRD §3.2, §3.6, §3.7). The main process owns
// PostgreSQL and the embedded server; the renderer only watches this state.
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { LIFECYCLE_MESSAGES, type LifecycleState, type LifecycleStatus } from '@shared/lifecycle';
import { createServer, type PosServer } from '../server/server';
import { readConfig, updateConfig } from './config';
import type { AppPaths } from './paths';
import { PgError, PgManager, type IposRestoreInfo } from './pg/PgManager';
import { createSecrets, loadSecrets, SecretsError, type DbSecrets } from './secrets';

export const SERVER_PORT = 3000;
const APP_USER = 'pos_app';
const DATABASE = 'mandiri_tani';

export interface LifecycleOptions {
  paths: AppPaths;
  logger: Logger;
  appVersion: string;
  /** Serve the built renderer from Express (production). */
  serveRenderer: boolean;
}

export class Lifecycle extends EventEmitter<{ change: [LifecycleStatus] }> {
  private current: LifecycleStatus = {
    state: 'BOOTING',
    message: LIFECYCLE_MESSAGES.BOOTING,
    at: new Date().toISOString(),
  };
  private pg: PgManager | null = null;
  private server: PosServer | null = null;
  private booting: Promise<void> | null = null;
  private shuttingDown: Promise<void> | null = null;
  /**
   * Sprint-3 decision S3-1 (until Sprint 2 logins): a fresh random key per app start, given
   * only to this PC's own window over IPC. The API treats it as OWNER on device K01.
   */
  readonly localAccessKey = randomBytes(32).toString('base64url');

  constructor(private readonly opts: LifecycleOptions) {
    super();
  }

  get status(): LifecycleStatus {
    return this.current;
  }

  get dbPort(): number | null {
    return this.pg?.port ?? null;
  }

  private set(state: LifecycleState, detail?: string): void {
    this.current = { state, message: LIFECYCLE_MESSAGES[state], detail, at: new Date().toISOString() };
    this.opts.logger.info({ state, detail }, 'lifecycle');
    this.emit('change', this.current);
  }

  boot(): Promise<void> {
    this.booting ??= this.runBoot().finally(() => {
      this.booting = null;
    });
    return this.booting;
  }

  private async runBoot(): Promise<void> {
    const { paths, logger } = this.opts;
    try {
      this.set('BOOTING');
      const config = readConfig(paths.configFile);
      let secrets: DbSecrets | null = loadSecrets(paths.secretsFile);
      const makeManager = (s: DbSecrets) =>
        new PgManager({
          binDir: paths.pgBinDir,
          dataDir: paths.pgData,
          logDir: paths.logDir,
          port: config.pgPort,
          maxPort: 5440,
          superuserPassword: s.superuserPassword,
          appUser: APP_USER,
          appPassword: s.appPassword,
          database: DATABASE,
          logger: logger.child({ component: 'pg' }),
        });

      // A first run that died between initdb and creating the app role is redone from scratch.
      await makeManager(secrets ?? { superuserPassword: '', appPassword: '' }).discardIncompleteCluster();

      const fresh = !existsSync(join(paths.pgData, 'PG_VERSION'));
      if (!secrets) {
        if (!fresh) {
          throw new SecretsError(
            'Data database ada tetapi kunci aksesnya hilang. Pulihkan file secrets.bin atau dari backup.',
          );
        }
        secrets = createSecrets(paths.secretsFile);
      }
      this.pg = makeManager(secrets);

      if (fresh) {
        this.set('DB_INIT');
        await this.pg.initCluster();
      } else {
        this.set('DB_STARTING');
        await this.pg.start();
      }
      if (this.pg.port !== config.pgPort) updateConfig(paths.configFile, { pgPort: this.pg.port });

      this.set('MIGRATING');
      await this.server?.stop(0).catch(() => undefined);
      this.server = createServer({
        host: '0.0.0.0',
        port: SERVER_PORT,
        db: {
          host: '127.0.0.1',
          port: this.pg.port,
          database: DATABASE,
          user: APP_USER,
          password: secrets.appPassword,
        },
        appVersion: this.opts.appVersion,
        logger: logger.child({ component: 'server' }),
        migrationsDir: paths.migrationsDir,
        staticDir: this.opts.serveRenderer ? paths.rendererDir : undefined,
        localAccessKey: this.localAccessKey,
        // Only the main process may run pg_dump (golden rule 8) — the server asks through this hook (S3-4).
        hooks: { backup: (label) => this.requirePg().backupDatabase(paths.backupDir, label) },
      });
      await this.server.migrate();

      this.set('SERVER_STARTING');
      await this.server.start();

      this.set('READY');
    } catch (err) {
      logger.error({ err }, 'boot failed');
      this.set('FATAL', describe(err));
    }
  }

  private requirePg(): PgManager {
    if (!this.pg || this.current.state !== 'READY')
      throw new PgError('Database belum siap. Tunggu sampai aplikasi selesai menyala.');
    return this.pg;
  }

  /** FR-MIG-01: restore an iPOS backup into the temporary import database. */
  restoreIposBackup(file: string): Promise<IposRestoreInfo> {
    return this.requirePg().restoreIposBackup(file, join(this.opts.paths.dataDir, 'tmp'));
  }

  async dropIposImport(): Promise<void> {
    await this.pg?.dropIposImport();
  }

  /** After sleep/hibernate: make sure PostgreSQL is still up (PRD §3.7). */
  async healthCheck(): Promise<void> {
    if (this.current.state !== 'READY' || !this.pg) return;
    try {
      if ((await this.pg.status()) !== 'running') {
        this.opts.logger.warn('PostgreSQL not running after resume — restarting');
        await this.pg.start();
      }
    } catch (err) {
      this.opts.logger.error({ err }, 'health check after resume failed');
      this.set('FATAL', describe(err));
    }
  }

  /** HTTP close → pool.end() → pg_ctl stop -m fast (fallback immediate). Idempotent (PRD §3.6). */
  shutdown(pgTimeoutSec = 30): Promise<void> {
    this.shuttingDown ??= (async () => {
      this.set('SHUTTING_DOWN');
      await this.booting?.catch(() => undefined);
      try {
        await this.server?.stop(5_000);
      } catch (err) {
        this.opts.logger.error({ err }, 'server stop failed');
      }
      try {
        await this.pg?.stop(pgTimeoutSec);
      } catch (err) {
        this.opts.logger.error({ err }, 'PostgreSQL stop failed');
      }
    })();
    return this.shuttingDown;
  }
}

function describe(err: unknown): string {
  if (err instanceof PgError) return err.detail ? `${err.message}\n${err.detail}` : err.message;
  if (err instanceof SecretsError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
