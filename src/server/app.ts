import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import type { DbConfig, Pool } from './db/pool';
import { authenticate } from './middleware/auth';
import { errorHandler, notFound } from './middleware/error-handler';
import { requestContext } from './middleware/request-id';
import { customerRoutes } from './modules/customers/routes';
import { healthRoutes } from './modules/health/routes';
import { importRoutes } from './modules/imports/routes';
import type { ImportHooks } from './modules/imports/service';
import { masterRoutes } from './modules/masters/routes';
import { paymentMethodRoutes } from './modules/payment-methods/routes';
import { productRoutes } from './modules/products/routes';
import { stockRoutes } from './modules/stock/routes';
import { supplierRoutes } from './modules/suppliers/routes';

export interface AppDeps {
  pool: Pool;
  logger: Logger;
  appVersion: string;
  /** Sprint-3 decision S3-1: per-start key handed only to this PC's own window. No key = every API call is 401. */
  localAccessKey?: string;
  /** Temporary iPOS database restored by the main process (sprint-3 S3-3). */
  iposDb?: DbConfig;
  /** Things only the main process can do (backups via pg_dump — sprint-3 S3-4). */
  hooks?: ImportHooks;
  /** Built renderer (out/renderer). Served at / in production so UI and API share one origin (ADR-01). */
  staticDir?: string;
}

export function createApp({ pool, logger, appVersion, localAccessKey, iposDb, hooks, staticDir }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false); // never trust X-Forwarded-For: no auth decision may depend on client IP

  app.use(requestContext(logger));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: '2mb' }));

  const api = express.Router();
  api.use(healthRoutes({ pool, appVersion }));
  // Everything below needs a credential — no exception for localhost/LAN (security-standards §1).
  api.use(authenticate({ localAccessKey, hubDeviceId: hubDeviceIdLoader(pool) }));
  api.use(masterRoutes({ pool }));
  api.use(customerRoutes({ pool }));
  api.use(supplierRoutes({ pool }));
  api.use(paymentMethodRoutes({ pool }));
  api.use(productRoutes({ pool }));
  api.use(stockRoutes({ pool }));
  if (iposDb) api.use(importRoutes({ pool, iposDb, hooks }));
  api.use(notFound);
  app.use('/api/v1', api);

  if (staticDir && existsSync(join(staticDir, 'index.html'))) {
    // The build uses relative asset URLs (./assets/…) so the boot screen also loads from file://.
    // Served over HTTP, <base href="/"> keeps them working when a deep link like /barang/123 is reloaded.
    const shell = readFileSync(join(staticDir, 'index.html'), 'utf8').replace('<head>', '<head><base href="/" />');
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    // SPA fallback: every non-API GET gets the app shell.
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.type('html').set('Cache-Control', 'no-cache').send(shell);
    });
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

/** The hub PC's device id (K01), looked up once and cached. */
function hubDeviceIdLoader(pool: Pool): () => Promise<string | null> {
  let cached: string | null = null;
  return async () => {
    cached ??= (await pool.query<{ id: string }>("SELECT id FROM devices WHERE code = 'K01'")).rows[0]?.id ?? null;
    return cached;
  };
}
