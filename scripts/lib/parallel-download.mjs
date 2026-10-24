// Robust large-file download for slow or throttled links (measured ~30 KB/s per
// connection to the EDB CDN): fetches fixed-size byte ranges over many parallel
// connections, retries each chunk on its own, and resumes across runs through a
// `<dest>.part.done` list. Every chunk requests the ORIGINAL url so short-lived signed
// redirect targets (GitHub release assets) never expire mid-download.
import { appendFileSync, createWriteStream, existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Windows' own bsdtar (reads .zip). Must be called by full path: Git Bash puts GNU tar
 * first on PATH, which treats "C:" in an archive path as a remote host and fails.
 */
export function windowsTar() {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
}

async function headWithRetry(url, log) {
  for (let attempt = 1; ; attempt++) {
    try {
      const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(60_000) });
      if (!head.ok) throw new Error(`HTTP ${head.status}`);
      return head;
    } catch (err) {
      if (attempt >= 6) throw new Error(`HEAD ${url} failed: ${err.message}`, { cause: err });
      log(`HEAD failed (${err.message}), retrying…`);
      await sleep(3000 * attempt);
    }
  }
}

export async function downloadParallel(url, dest, { log = () => {}, chunkSize = 4 * 1024 * 1024, concurrency = 16 } = {}) {
  const head = await headWithRetry(url, log);
  const total = Number(head.headers.get('content-length') ?? 0);
  const tmp = `${dest}.part`;
  const doneFile = `${tmp}.done`;

  if (!total || head.headers.get('accept-ranges') !== 'bytes') {
    log('server does not support ranges — single stream (slow)');
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    renameSync(tmp, dest);
    return;
  }

  if (existsSync(tmp) && !existsSync(doneFile)) rmSync(tmp); // leftover from an old single-stream run
  const done = new Set(
    existsSync(doneFile) ? readFileSync(doneFile, 'utf8').split('\n').filter(Boolean).map(Number) : [],
  );
  const chunks = Math.ceil(total / chunkSize);
  const fh = await open(tmp, existsSync(tmp) ? 'r+' : 'w');
  await fh.truncate(total);
  if (done.size) log(`resuming: ${done.size}/${chunks} chunks already downloaded`);

  let next = 0;
  let lastPct = -1;
  const startedWith = done.size;
  const started = Date.now();
  const report = () => {
    const pct = Math.floor((done.size / chunks) * 100);
    if (pct === lastPct || pct % 5 !== 0) return;
    lastPct = pct;
    const mb = Math.min(done.size * chunkSize, total) / 1e6;
    const kbs = (((done.size - startedWith) * chunkSize) / 1024 / Math.max(1, (Date.now() - started) / 1000)).toFixed(0);
    log(`${pct}% (${mb.toFixed(0)} / ${(total / 1e6).toFixed(0)} MB, ~${kbs} KB/s)`);
  };

  async function fetchChunk(i) {
    const start = i * chunkSize;
    const end = Math.min(total, start + chunkSize) - 1;
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { Range: `bytes=${start}-${end}` },
          signal: AbortSignal.timeout(10 * 60 * 1000),
        });
        if (res.status !== 206) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length !== end - start + 1) throw new Error(`short chunk ${buf.length}`);
        await fh.write(buf, 0, buf.length, start);
        done.add(i);
        appendFileSync(doneFile, `${i}\n`);
        report();
        return;
      } catch (err) {
        if (attempt >= 8) throw new Error(`chunk ${i} failed after ${attempt} attempts: ${err.message}`, { cause: err });
        await sleep(2000 * attempt);
      }
    }
  }

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= chunks) return;
      if (!done.has(i)) await fetchChunk(i);
    }
  }

  try {
    await Promise.all(Array.from({ length: concurrency }, worker));
  } finally {
    await fh.close();
  }
  renameSync(tmp, dest);
  rmSync(doneFile, { force: true });
}
