import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import type { Pool } from './db/pool';
import { errorHandler, notFound } from './middleware/error-handler';
import { requestContext } from './middleware/request-id';
import { healthRoutes } from './modules/health/routes';

export interface AppDeps {
  pool: Pool;
  logger: Logger;
  appVersion: string;
  /** Built renderer (out/renderer). Served at / in production so UI and API share one origin (ADR-01). */
  staticDir?: string;
}

export function createApp({ pool, logger, appVersion, staticDir }: AppDeps): Express {
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
  api.use(notFound);
  app.use('/api/v1', api);

  if (staticDir && existsSync(join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    // SPA fallback: every non-API GET gets the app shell.
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(staticDir, 'index.html')));
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
