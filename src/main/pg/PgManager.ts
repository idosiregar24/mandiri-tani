// Owns the portable PostgreSQL cluster: initdb, configure, start, stop (PRD §3.3–3.6).
// Pure Node — no `electron` import — so Vitest drives it against the real binaries.
// Every binary runs through execFile with an argument array: install and data paths
// contain spaces/commas, so a shell command string would break (desktop-runtime §2).
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import pg from 'pg';

export interface PgLogger {
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
}

export interface PgManagerOptions {
  binDir: string;
  dataDir: string;
  logDir: string;
  /** Preferred port; the next ports up to `maxPort` are tried when it is taken by another program. */
  port: number;
  maxPort: number;
  superuserPassword: string;
  appUser: string;
  appPassword: string;
  database: string;
  logger?: PgLogger;
}

export type ClusterStatus = 'running' | 'stopped' | 'no-data';

export interface StartResult {
  port: number;
  /** A cluster left running by a previous (crashed) session was adopted (PRD §3.4 step 2). */
  reused: boolean;
  /** A stale postmaster.pid had to be removed before starting. */
  removedStalePid: boolean;
}

export class PgError extends Error {
  constructor(
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'PgError';
  }
}

const silent: PgLogger = { info() {}, warn() {}, error() {} };
const COMPLETE_MARKER = 'mandiri_tani.initialized';

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Temporary database the iPOS backup is restored into (sprint-3 S3-3); owned by the app role. */
export const IPOS_IMPORT_DB = 'ipos_import';

/** What restoreIposBackup() found in the file — also written to `_mtpos_source` in ipos_import. */
export interface IposRestoreInfo {
  fileName: string;
  sha256: string;
  sizeBytes: number;
  /** "Archive created at" from the dump header, as written there (iPOS PC local time, WIB). */
  dumpCreatedAt: string | null;
  sourceDatabase: string | null;
  sourceVersion: string | null;
  tables: number;
}

export class PgManager {
  private readonly log: PgLogger;
  private currentPort: number;

  constructor(private readonly opts: PgManagerOptions) {
    this.log = opts.logger ?? silent;
    this.currentPort = opts.port;
  }

  get port(): number {
    return this.currentPort;
  }

  isInitialized(): boolean {
    return existsSync(join(this.opts.dataDir, 'PG_VERSION'));
  }

  /** initdb ran AND the app role/database were created (marker written last). */
  isComplete(): boolean {
    return existsSync(join(this.opts.dataDir, COMPLETE_MARKER));
  }

  /**
   * A first run interrupted between initdb and creating the app role (crash, power cut,
   * closed window) leaves a cluster the app cannot log into. Stop it, move it aside and
   * report true so the caller runs initCluster again.
   */
  async discardIncompleteCluster(): Promise<boolean> {
    if (!this.isInitialized() || this.isComplete()) return false;
    this.log.warn(
      { dataDir: this.opts.dataDir },
      'incomplete first-run cluster found — discarding and re-initialising',
    );
    await this.stop(10).catch(() => undefined);
    this.moveAside('incomplete');
    return true;
  }

  // ------------------------------------------------------------------ binaries
  private bin(name: string): string {
    return join(this.opts.binDir, `${name}.exe`);
  }

  /** `withPassword`: log in as the app role — the password goes through PGPASSWORD, never argv (desktop-runtime §2). */
  private run(name: string, args: string[], timeoutMs: number, withPassword = false): Promise<ExecResult> {
    const env = withPassword ? { ...process.env, PGPASSWORD: this.opts.appPassword } : process.env;
    return new Promise((resolve) => {
      execFile(
        this.bin(name),
        args,
        { windowsHide: true, timeout: timeoutMs, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env },
        (err, stdout, stderr) => {
          const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
          resolve({ code, stdout: String(stdout), stderr: String(stderr || (err && !stderr ? err.message : '')) });
        },
      );
    });
  }

  // ------------------------------------------------------------------ status
  async status(): Promise<ClusterStatus> {
    if (!this.isInitialized()) return 'no-data';
    const r = await this.run('pg_ctl', ['status', '-D', this.opts.dataDir], 15_000);
    // pg_ctl status: 0 = running, 3 = not running, 4 = no accessible data directory
    if (r.code === 0) return 'running';
    if (r.code === 4) return 'no-data';
    return 'stopped';
  }

  private readPidFile(): { pid: number; port: number } | null {
    const file = join(this.opts.dataDir, 'postmaster.pid');
    if (!existsSync(file)) return null;
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    const pid = Number(lines[0]);
    const port = Number(lines[3]);
    return Number.isFinite(pid) && Number.isFinite(port) ? { pid, port } : null;
  }

  // ------------------------------------------------------------------ initdb
  /**
   * First run: initdb + managed config + pg_hba (loopback scram only) + app role & database.
   * Leaves the cluster running. On failure the half-made directory is moved aside to
   * `<dataDir>.failed-<timestamp>` (never deleted) so the next attempt starts clean.
   */
  async initCluster(): Promise<void> {
    if (this.isInitialized()) throw new PgError('Cluster sudah ada — initdb tidak dijalankan ulang.');
    const { dataDir } = this.opts;
    if (existsSync(dataDir)) this.moveAside('leftover');
    mkdirSync(this.opts.logDir, { recursive: true });

    const pwfile = join(tmpdir(), `mtpos-${randomBytes(8).toString('hex')}.pw`);
    writeFileSync(pwfile, this.opts.superuserPassword, { mode: 0o600 });
    let started = false;
    try {
      this.log.info({ dataDir }, 'initdb');
      const r = await this.run(
        'initdb',
        [
          '-D',
          dataDir,
          '-U',
          'postgres',
          `--pwfile=${pwfile}`,
          '--auth=scram-sha-256',
          '--encoding=UTF8',
          '--locale-provider=builtin',
          '--builtin-locale=C.UTF-8',
        ],
        180_000,
      );
      if (r.code !== 0) throw new PgError('initdb gagal.', r.stderr || r.stdout);
    } catch (err) {
      this.moveAside('failed');
      throw err;
    } finally {
      rmSync(pwfile, { force: true });
    }

    try {
      appendFileSync(join(dataDir, 'postgresql.conf'), "\ninclude_if_exists = 'mandiri_tani.conf'\n");
      writeFileSync(
        join(dataDir, 'pg_hba.conf'),
        [
          '# Managed by Mandiri Tani POS — loopback only, scram-sha-256 (security-standards §6).',
          '# TYPE  DATABASE  USER  ADDRESS        METHOD',
          'host    all       all   127.0.0.1/32   scram-sha-256',
          'host    all       all   ::1/128        scram-sha-256',
          '',
        ].join('\n'),
      );
      await this.start();
      started = true;
      await this.createAppRoleAndDatabase();
      writeFileSync(join(dataDir, COMPLETE_MARKER), `${new Date().toISOString()}\n`);
    } catch (err) {
      if (started) await this.stop().catch(() => undefined);
      this.moveAside('failed');
      throw err;
    }
  }

  private moveAside(reason: string): void {
    const target = `${this.opts.dataDir}.${reason}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try {
      renameSync(this.opts.dataDir, target);
      this.log.warn({ target }, 'moved data directory aside');
    } catch {
      /* nothing to move */
    }
  }

  private writeManagedConf(port: number): void {
    const logDir = this.opts.logDir.replace(/\\/g, '/');
    const conf = [
      '# Managed by Mandiri Tani POS — rewritten on every start. Do not edit (PRD §3.3).',
      `port = ${port}`,
      "listen_addresses = '127.0.0.1'",
      'max_connections = 30',
      'shared_buffers = 128MB',
      'work_mem = 8MB',
      '# Durability: never turn these off (NFR-REL-01).',
      'fsync = on',
      'synchronous_commit = on',
      'full_page_writes = on',
      'wal_level = replica',
      'max_wal_size = 512MB',
      'checkpoint_timeout = 5min',
      'logging_collector = on',
      `log_directory = '${logDir}'`,
      "log_filename = 'postgres-%a.log'",
      'log_truncate_on_rotation = on',
      'log_rotation_age = 1d',
      'log_min_duration_statement = 500',
      'idle_in_transaction_session_timeout = 60s',
      "timezone = 'Asia/Jakarta'",
      "log_timezone = 'Asia/Jakarta'",
      '',
    ].join('\n');
    writeFileSync(join(this.opts.dataDir, 'mandiri_tani.conf'), conf);
  }

  private async asSuperuser<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
    const client = new pg.Client({
      host: '127.0.0.1',
      port: this.currentPort,
      user: 'postgres',
      password: this.opts.superuserPassword,
      database: 'postgres',
    });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }

  private async createAppRoleAndDatabase(): Promise<void> {
    await this.asSuperuser(async (client) => {
      const role = client.escapeIdentifier(this.opts.appUser);
      const db = client.escapeIdentifier(this.opts.database);
      await client.query(`CREATE ROLE ${role} LOGIN PASSWORD ${client.escapeLiteral(this.opts.appPassword)}`);
      await client.query(`CREATE DATABASE ${db} OWNER ${role} ENCODING 'UTF8'`);
      await client.query(`REVOKE ALL ON DATABASE postgres FROM PUBLIC`);
      this.log.info({ role: this.opts.appUser, database: this.opts.database }, 'app role and database created');
    });
  }

  // ------------------------------------------------------------------ start
  async start(): Promise<StartResult> {
    if (!this.isInitialized()) throw new PgError('Data database belum ada — jalankan initCluster dulu.');
    mkdirSync(this.opts.logDir, { recursive: true });

    if ((await this.status()) === 'running') {
      const pid = this.readPidFile();
      if (pid) this.currentPort = pid.port;
      this.log.warn({ port: this.currentPort }, 'adopting PostgreSQL left running by a previous session');
      await this.waitReady();
      return { port: this.currentPort, reused: true, removedStalePid: false };
    }

    const port = await this.pickPort();
    this.currentPort = port;
    this.writeManagedConf(port);

    let removedStalePid = false;
    let r = await this.pgCtlStart(port);
    if (r.code !== 0 && (await this.removeStalePid())) {
      removedStalePid = true;
      r = await this.pgCtlStart(port);
    }
    if (r.code !== 0) {
      throw new PgError(
        'PostgreSQL gagal dinyalakan.',
        `${r.stderr || r.stdout}\nLihat log: ${join(this.opts.logDir, 'pg_ctl.log')}`,
      );
    }
    await this.waitReady();
    this.log.info({ port }, 'PostgreSQL started');
    return { port, reused: false, removedStalePid };
  }

  /**
   * `pg_ctl start` must NOT get stdout/stderr pipes: on Windows the postmaster inherits
   * them, so Node would wait for the pipes to close — i.e. until PostgreSQL shuts down.
   * Output goes to a file instead, and we wait for pg_ctl's own 'exit', not 'close'.
   * -w waits until the server accepts connections; crash recovery (WAL replay) after a
   * power cut happens inside that wait, hence the generous timeout.
   */
  private pgCtlStart(port: number): Promise<ExecResult> {
    const outFile = join(this.opts.logDir, 'pg_ctl-start.out');
    const fd = openSync(outFile, 'w');
    return new Promise((resolve) => {
      const child = spawn(
        this.bin('pg_ctl'),
        [
          'start',
          '-D',
          this.opts.dataDir,
          '-l',
          join(this.opts.logDir, 'pg_ctl.log'),
          '-w',
          '-t',
          '120',
          '-o',
          `-p ${port}`,
        ],
        { windowsHide: true, stdio: ['ignore', fd, fd] },
      );
      const timer = setTimeout(() => child.kill(), 150_000);
      const finish = (code: number) => {
        clearTimeout(timer);
        closeSync(fd);
        const output = readFileSync(outFile, 'utf8');
        resolve({ code, stdout: output, stderr: code === 0 ? '' : output });
      };
      child.once('error', (err) => {
        clearTimeout(timer);
        closeSync(fd);
        resolve({ code: -1, stdout: '', stderr: err.message });
      });
      child.once('exit', (code) => finish(code ?? -1));
    });
  }

  /** A postmaster.pid whose process is gone (or is not postgres) blocks start-up — remove it. */
  private async removeStalePid(): Promise<boolean> {
    const info = this.readPidFile();
    if (!info) return false;
    if (await this.isPostgresProcess(info.pid)) return false;
    rmSync(join(this.opts.dataDir, 'postmaster.pid'), { force: true });
    this.log.warn({ pid: info.pid }, 'removed stale postmaster.pid');
    return true;
  }

  private isPostgresProcess(pid: number): Promise<boolean> {
    return new Promise((resolve) => {
      execFile(
        'tasklist',
        ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
        { windowsHide: true, encoding: 'utf8', timeout: 10_000 },
        (err, stdout) => resolve(!err && /"postgres\.exe"/i.test(String(stdout))),
      );
    });
  }

  private async pickPort(): Promise<number> {
    for (let port = this.opts.port; port <= this.opts.maxPort; port++) {
      if (await isPortFree(port)) return port;
      this.log.warn({ port }, 'port taken by another program, trying next');
    }
    throw new PgError(`Tidak ada port kosong untuk database (${this.opts.port}–${this.opts.maxPort}).`);
  }

  private async waitReady(): Promise<void> {
    const r = await this.run('pg_isready', ['-h', '127.0.0.1', '-p', String(this.currentPort), '-t', '60'], 70_000);
    if (r.code !== 0) throw new PgError('Database tidak merespons setelah dinyalakan.', r.stdout || r.stderr);
  }

  // ------------------------------------------------------------------ backup & iPOS import
  /** `pg_dump -Fc` of the app database into `dir` (PRD §3.5). Returns the file path. */
  async backupDatabase(dir: string, label: string): Promise<string> {
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(dir, `${label}-${stamp}.dump`);
    const r = await this.run(
      'pg_dump',
      [
        '-Fc',
        '-h',
        '127.0.0.1',
        '-p',
        String(this.currentPort),
        '-U',
        this.opts.appUser,
        '-d',
        this.opts.database,
        '-f',
        file,
      ],
      10 * 60_000,
      true,
    );
    if (r.code !== 0) {
      rmSync(file, { force: true });
      throw new PgError('Backup database gagal.', r.stderr);
    }
    this.log.info({ file }, 'database backup written');
    return file;
  }

  /**
   * FR-MIG-01, sprint-3 S3-3: restore ONLY the tables and their data of an iPOS 5 backup
   * (`.i5bu` = pg_dump custom format from PG 9.5) into a fresh `ipos_import` database owned
   * by the app role. iPOS functions/triggers/FKs are left out (their functions are missing).
   * The source file is only read — never changed or sent anywhere (FR-MIG-07).
   */
  async restoreIposBackup(file: string, workDir: string): Promise<IposRestoreInfo> {
    const sha256 = await sha256File(file);
    const toc = await this.run('pg_restore', ['-l', file], 2 * 60_000);
    if (toc.code !== 0) {
      throw new PgError(
        'File ini tidak bisa dibaca sebagai backup iPOS. Pastikan memilih file .i5bu hasil backup iPOS 5.',
        toc.stderr,
      );
    }
    const header = (key: string) => new RegExp(`^;\\s+${key}:?\\s+(.+)$`, 'm').exec(toc.stdout)?.[1]?.trim() ?? null;
    const entries = toc.stdout.split(/\r?\n/).filter((l) => /^\d+; \d+ \d+ TABLE (DATA )?\S+ \S+/.test(l));
    const tables = entries.filter((l) => !/ TABLE DATA /.test(l)).length;
    if (tables === 0) throw new PgError('Backup ini tidak berisi tabel apa pun.');

    mkdirSync(workDir, { recursive: true });
    const listFile = join(workDir, `ipos-toc-${process.pid}.list`);
    writeFileSync(listFile, entries.join('\n') + '\n');
    try {
      await this.dropIposImport();
      await this.asSuperuser((c) =>
        c.query(`CREATE DATABASE ${IPOS_IMPORT_DB} OWNER ${c.escapeIdentifier(this.opts.appUser)} ENCODING 'UTF8'`),
      );
      const r = await this.run(
        'pg_restore',
        [
          '--no-owner',
          '--no-privileges',
          '-h',
          '127.0.0.1',
          '-p',
          String(this.currentPort),
          '-U',
          this.opts.appUser,
          '-d',
          IPOS_IMPORT_DB,
          '-L',
          listFile,
          file,
        ],
        10 * 60_000,
        true,
      );
      if (r.code !== 0)
        throw new PgError('Isi backup iPOS gagal dibaca.', r.stderr.split(/\r?\n/).slice(-20).join('\n'));
    } catch (err) {
      await this.dropIposImport().catch(() => undefined);
      throw err;
    } finally {
      rmSync(listFile, { force: true });
    }

    const info: IposRestoreInfo = {
      fileName: basename(file),
      sha256,
      sizeBytes: statSync(file).size,
      dumpCreatedAt: header('Archive created at'),
      sourceDatabase: header('dbname'),
      sourceVersion: header('Dumped from database version'),
      tables,
    };
    const client = new pg.Client({
      host: '127.0.0.1',
      port: this.currentPort,
      user: this.opts.appUser,
      password: this.opts.appPassword,
      database: IPOS_IMPORT_DB,
    });
    await client.connect();
    try {
      await client.query(`CREATE TABLE _mtpos_source (
        file_name text NOT NULL, sha256 text NOT NULL, size_bytes bigint NOT NULL, dump_created_at text,
        source_database text, source_version text, tables integer NOT NULL, restored_at timestamptz NOT NULL DEFAULT now())`);
      await client.query(
        `INSERT INTO _mtpos_source (file_name, sha256, size_bytes, dump_created_at, source_database, source_version, tables)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          info.fileName,
          info.sha256,
          info.sizeBytes,
          info.dumpCreatedAt,
          info.sourceDatabase,
          info.sourceVersion,
          info.tables,
        ],
      );
    } finally {
      await client.end();
    }
    this.log.info({ fileName: info.fileName, sha256, tables }, 'iPOS backup restored into ipos_import');
    return info;
  }

  /** Removes the temporary iPOS database (after an import, or when the owner cancels). Idempotent. */
  async dropIposImport(): Promise<void> {
    await this.asSuperuser((c) => c.query(`DROP DATABASE IF EXISTS ${IPOS_IMPORT_DB} WITH (FORCE)`));
  }

  // ------------------------------------------------------------------ stop
  /** Fast shutdown (rolls back open transactions, committed data is safe); immediate as last resort. */
  async stop(timeoutSec = 30): Promise<void> {
    if ((await this.status()) !== 'running') return;
    const fast = await this.run(
      'pg_ctl',
      ['stop', '-D', this.opts.dataDir, '-m', 'fast', '-w', '-t', String(timeoutSec)],
      (timeoutSec + 10) * 1000,
    );
    if (fast.code === 0) {
      this.log.info('PostgreSQL stopped');
      return;
    }
    this.log.error({ detail: fast.stderr }, 'fast shutdown failed, using immediate (WAL recovery on next start)');
    const immediate = await this.run(
      'pg_ctl',
      ['stop', '-D', this.opts.dataDir, '-m', 'immediate', '-w', '-t', '10'],
      20_000,
    );
    if (immediate.code !== 0) throw new PgError('PostgreSQL gagal dimatikan.', immediate.stderr);
  }
}

export function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** 32 random bytes, hex — safe inside SQL literals and config files. */
export function generatePassword(): string {
  return randomBytes(32).toString('hex');
}
