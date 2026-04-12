import { defineConfig } from 'vitest/config';

/**
 * Vitest-only config — keeps `vite.config.js` free of `vitest/config` so Vercel
 * production builds (no devDependencies / no vitest in bundle path) still work.
 */
export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-server/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
    ],
  },
});
