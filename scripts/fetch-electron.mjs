// Fallback for Electron's own installer on slow/unstable links: downloads the official
// win32-x64 zip with parallel ranges, verifies it against the SHA-256 shipped inside the
// electron npm package (checksums.json), and extracts it to node_modules/electron/dist.
// Usage: node scripts/fetch-electron.mjs
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { downloadParallel, windowsTar } from './lib/parallel-download.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'node_modules', 'electron');
const { version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const name = `electron-v${version}-win32-x64.zip`;
const url = `https://github.com/electron/electron/releases/download/v${version}/${name}`;
const expected = JSON.parse(readFileSync(join(pkgDir, 'checksums.json'), 'utf8'))[name];
const zipPath = join(root, '.cache', name);
const distDir = join(pkgDir, 'dist');

const log = (msg) => process.stdout.write(`[fetch-electron] ${msg}\n`);

async function sha256(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function main() {
  if (existsSync(join(distDir, 'electron.exe')) && readFileSync(join(distDir, 'version'), 'utf8').trim().replace(/^v/, '') === version) {
    log(`Electron ${version} already installed`);
    return;
  }
  if (!expected) throw new Error(`no checksum for ${name} in electron/checksums.json`);
  mkdirSync(dirname(zipPath), { recursive: true });
  if (!existsSync(zipPath)) {
    log(`downloading ${url}`);
    await downloadParallel(url, zipPath, { log });
  }
  const actual = await sha256(zipPath);
  if (actual !== expected) {
    rmSync(zipPath);
    throw new Error(`SHA-256 mismatch for ${name}: expected ${expected}, got ${actual} (cached file deleted)`);
  }
  log('SHA-256 verified');
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });
  execFileSync(windowsTar(), ['-xf', zipPath, '-C', distDir], { stdio: 'inherit' });
  writeFileSync(join(pkgDir, 'path.txt'), 'electron.exe');
  log(`installed: ${execFileSync(join(distDir, 'electron.exe'), ['--version'], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } }).trim()}`);
}

main().catch((err) => {
  process.stderr.write(`[fetch-electron] ERROR: ${err.message}\n`);
  process.exit(1);
});
