// The embedded API as a self-contained unit (ADR-07): no `electron` import, so it runs
// in Vitest and could later move to an Electron utilityProcess unchanged.
import { createServer as createHttpServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import type { Logger } from 'pino';
import { createApp } from './app';
import { runMigrations, type MigrationResult } from './db/migrate';
import { createPool, type DbConfig, type Pool } from './db/pool';
import { ensureHubDevice } from './db/bootstrap';
import { AppError } from './lib/errors';

export interface ServerConfig {
  host: string; // '0.0.0.0' in the app (FR-SRV-01)
  port: number; // 3000
  db: DbConfig;
  appVersion: string;
  logger: Logger;
  migrationsDir: string;
  staticDir?: string;
}

export interface PosServer {
  readonly pool: Pool;
  migrate(): Promise<MigrationResult>;
  start(): Promise<{ port: number }>;
  /** Graceful: stop accepting, wait up to `drainMs` for in-flight requests, close the pool. */
  stop(drainMs?: number): Promise<void>;
}

export function createServer(config: ServerConfig): PosServer {
  const { logger } = config;
  const pool = createPool(config.db, (err) => logger.warn({ err }, 'idle database connection error'));
  let http: Server | null = null;
  const sockets = new Set<Socket>();
  let stopping: Promise<void> | null = null;

  return {
    pool,

    async migrate() {
      const result = await runMigrations(pool, config.migrationsDir, logger);
      await ensureHubDevice(pool);
      return result;
    },

    start() {
      const app = createApp({ pool, logger, appVersion: config.appVersion, staticDir: config.staticDir });
      http = createHttpServer(app);
      http.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
      });
      return new Promise((resolve, reject) => {
        http!.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            reject(
              new AppError(
                'PORT_IN_USE',
                `Port ${config.port} sudah dipakai program lain. Tutup program itu (atau aplikasi kasir yang masih terbuka) lalu coba lagi.`,
                500,
              ),
            );
          } else reject(err);
        });
        http!.listen(config.port, config.host, () => {
          const address = http!.address();
          const port = typeof address === 'object' && address ? address.port : config.port;
          logger.info({ host: config.host, port }, 'server listening');
          resolve({ port });
        });
      });
    },

    stop(drainMs = 5_000) {
      stopping ??= (async () => {
        if (http) {
          const server = http;
          await new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeIdleConnections();
            setTimeout(() => {
              for (const socket of sockets) socket.destroy();
              resolve();
            }, drainMs).unref();
          });
        }
        await pool.end();
        logger.info('server stopped');
      })();
      return stopping;
    },
  };
}
