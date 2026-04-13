import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
// Vitest options live in vitest.config.ts so production installs never require vitest/config.
export default defineConfig({
  plugins: [react()],
  // Prefer .tsx over .jsx so extensionless imports use the TypeScript source when both exist.
  resolve: {
    extensions: [
      '.mjs',
      '.js',
      '.mts',
      '.ts',
      '.tsx',
      '.jsx',
      '.json',
    ],
  },
  // Dev only: production (Vercel) serves the SPA and rewrites /api/* to the serverless function — no proxy.
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      }
    }
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-charts': ['recharts'],
          'vendor-ui': ['lucide-react', 'axios'],
        }
      }
    }
  }
})
