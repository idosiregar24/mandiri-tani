// Downloads the portable PostgreSQL binaries for Windows x64 (EDB zip), verifies
// SHA-256, and extracts only bin/, lib/ and share/ into resources/postgres/.
// Version: resources/postgres/VERSION. Expected hash: scripts/postgres.sha256.
// Usage: node scripts/fetch-postgres.mjs [--force]
import { createHash } from 'node:crypto';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { downloadParallel, windowsTar } from './lib/parallel-download.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetDir = join(root, 'resources', 'postgres');
const version = readFileSync(join(targetDir, 'VERSION'), 'utf8').trim();
const hashFile = join(root, 'scripts', 'postgres.sha256');
const cacheDir = join(root, '.cache');
const name = `postgresql-${version}-windows-x64-binaries.zip`;
const zipPath = join(cacheDir, name);
const url = `https://get.enterprisedb.com/postgresql/${name}`;
const force = process.argv.includes('--force');
const KEEP = ['bin', 'lib', 'share'];

const log = (msg) => process.stdout.write(`[fetch-postgres] ${msg}\n`);

function installedVersion() {
  const marker = join(targetDir, 'bin', '.installed');
  return existsSync(marker) ? readFileSync(marker, 'utf8').trim() : null;
}

async function sha256(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

function expectedHashes() {
  if (!existsSync(hashFile)) return {};
  return Object.fromEntries(
    readFileSync(hashFile, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const [hash, file] = l.split(/\s+/);
        return [file, hash.toLowerCase()];
      }),
  );
}

async function main() {
  if (!force && installedVersion() === version) {
    log(`PostgreSQL ${version} already installed in resources/postgres — use --force to reinstall`);
    return;
  }
  mkdirSync(cacheDir, { recursive: true });
  if (!existsSync(zipPath)) {
    log(`downloading ${url}`);
    await downloadParallel(url, zipPath, { log });
  } else {
    log(`using cached ${zipPath}`);
  }

  const actual = await sha256(zipPath);
  const expected = expectedHashes()[name];
  if (expected && expected !== actual) {
    rmSync(zipPath);
    throw new Error(`SHA-256 mismatch for ${name}: expected ${expected}, got ${actual} (cached file deleted)`);
  }
  if (!expected) {
    // Trust on first use: EDB does not publish checksums for the zip. Record it so every
    // later download (CI, other machines) must match this exact archive.
    appendFileSync(hashFile, `${actual}  ${name}\n`);
    log(`recorded SHA-256 ${actual} in scripts/postgres.sha256 — commit this file`);
  } else {
    log('SHA-256 verified');
  }

  for (const dir of KEEP) rmSync(join(targetDir, dir), { recursive: true, force: true });
  const staging = join(cacheDir, `pg-extract-${version}`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  log('extracting bin/, lib/, share/ (skipping pgAdmin, docs, headers, symbols)');
  // Windows 10+ ships bsdtar, which reads zip archives.
  execFileSync(windowsTar(), ['-xf', zipPath, '-C', staging, ...KEEP.map((d) => `pgsql/${d}`)], { stdio: 'inherit' });
  for (const dir of KEEP) renameSync(join(staging, 'pgsql', dir), join(targetDir, dir));
  rmSync(staging, { recursive: true, force: true });

  const out = execFileSync(join(targetDir, 'bin', 'pg_ctl.exe'), ['--version'], { encoding: 'utf8' }).trim();
  writeFileSync(join(targetDir, 'bin', '.installed'), `${version}\n`);
  log(`installed: ${out}`);
}

main().catch((err) => {
  process.stderr.write(`[fetch-postgres] ERROR: ${err.message}\n`);
  process.exit(1);
});
