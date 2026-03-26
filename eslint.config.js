import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

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
  // Node/server override: treat server-side files as Node environment
  {
    files: ['src/server/**', 'services/**', 'db/**', 'server/**'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'script'
      }
    },
    rules: {
      // allow CommonJS pattern on server files
      'no-undef': 'error'
    }
  }
])
