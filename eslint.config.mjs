import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'release/**', 'node_modules/**', 'resources/**', '.cache/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The shadcn CLI misreads the `@/lib/utils` alias and imports the unrelated npm package `cn`.
      'no-restricted-imports': ['error', { paths: [{ name: 'cn', message: 'Use `cn` from "@/lib/utils" (shadcn CLI bug).' }] }],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        AbortSignal: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Server code must stay Electron-free (ADR-07) and log through pino.
    files: ['src/server/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [{ name: 'electron', message: 'src/server must not import electron (ADR-07).' }] }],
    },
  },
);
