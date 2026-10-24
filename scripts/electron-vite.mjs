// Runs electron-vite with ELECTRON_RUN_AS_NODE removed. VS Code (itself Electron) exports
// ELECTRON_RUN_AS_NODE=1 into its terminals, which makes electron.exe behave as plain
// Node and the app never opens. Usage: node scripts/electron-vite.mjs <dev|build|preview> [...]
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve('electron-vite/package.json')), 'bin', 'electron-vite.js');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
