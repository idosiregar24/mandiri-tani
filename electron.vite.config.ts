import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const shared = resolve('src/shared');

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    build: { externalizeDeps: true },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: { externalizeDeps: true },
  },
  renderer: {
    resolve: { alias: { '@': resolve('src/renderer'), '@shared': shared } },
    plugins: [react(), tailwindcss()],
    server: {
      // Dev: the embedded API runs in the Electron main process on :3000.
      proxy: { '/api': 'http://127.0.0.1:3000' },
    },
  },
});
