import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig([
  // Ignore compiled output, server build output, Vercel/serverless API shim,
  // root-level utility/test/migration scripts, and config files — none of
  // these are application source that needs browser-environment linting.
  globalIgnores([
    'dist',
    'dist-server',
    'api',
    'scripts',
    '*.js',     // root-level config & utility scripts (postcss, tailwind, vite, test-*, etc.)
  ]),

  // ── JavaScript / JSX (browser) ────────────────────────────────────────────
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]' }],
      'no-empty': 'off',
    },
  },

  // ── TypeScript / TSX (browser + React) ───────────────────────────────────
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      ...tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // Downgrade unused-vars to warn (tsc handles type errors already)
      '@typescript-eslint/no-unused-vars': ['warn', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // Allow `any` casts where necessary (legacy code)
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow require() in server-side files
      '@typescript-eslint/no-require-imports': 'off',
      // Don't enforce return types on every function
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      // Legacy TypeScript namespace pattern — warn, not error
      '@typescript-eslint/no-namespace': 'warn',
      // `Function` type in legacy service code — warn, not error
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      // HMR fast-refresh hint — warn only (non-blocking)
      'react-refresh/only-export-components': 'warn',
      'no-empty': 'off',
    },
  },

  // ── Node/server override ──────────────────────────────────────────────────
  {
    files: ['src/server/**', 'services/**', 'db/**', 'server/**'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      'no-undef': 'error',
    },
  },
])
