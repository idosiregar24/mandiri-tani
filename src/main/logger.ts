// Structured JSON log to %APPDATA%/pos-desktop/logs/app-YYYY-MM-DD.log, kept 30 days
// (desktop-runtime §7). Never log passwords, PINs, tokens or secrets.bin content.
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import pino, { type Logger } from 'pino';

const RETENTION_DAYS = 30;

function pruneOldLogs(logDir: string): void {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const name of readdirSync(logDir)) {
    if (!/^app-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue;
    const file = join(logDir, name);
    if (statSync(file).mtimeMs < cutoff) rmSync(file, { force: true });
  }
}

export function createLogger(logDir: string, toConsole: boolean): Logger {
  pruneOldLogs(logDir);
  const day = new Date().toISOString().slice(0, 10);
  const streams: pino.StreamEntry[] = [
    { level: 'info', stream: pino.destination({ dest: join(logDir, `app-${day}.log`), mkdir: true, sync: false }) },
  ];
  if (toConsole) streams.push({ level: 'debug', stream: process.stdout });
  return pino(
    {
      level: 'debug',
      base: { app: 'mandiri-tani-pos' },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: ['*.password', '*.pin', '*.token', 'password', 'pin', 'token'], censor: '[disembunyikan]' },
    },
    pino.multistream(streams),
  );
}
