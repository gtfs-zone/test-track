import { defineConfig } from 'vite'
import { resolve } from 'path'
import { execSync } from 'child_process'

let version
try {
  // Exactly on a tag: use the clean tag name (e.g. "0.3.1").
  version = execSync('git describe --tags --exact-match').toString().trim().replace(/^v/, '')
} catch {
  try {
    // Between tags: tag + commit count + hash (e.g. "0.3.1-2-gabc1234").
    version = execSync('git describe --tags --long --always').toString().trim().replace(/^v/, '')
  } catch {
    version = '0.0.0-development'
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version)
  },
  root: 'src',
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/index.html')
    }
  },
  server: {
    // The local cafe-car is fetched directly rather than through a dev proxy
    // (see RT_BASE in src/modules/feed-url-resolve.ts), so this origin has to be
    // one music-student's CORS_ALLOWED_ORIGINS names. It allows 8080-8089, which
    // covers the range vite falls through to when a port is taken.
    port: 8080,
    open: true,
    host: true
  },
  css: {
    postcss: './postcss.config.js'
  },
  resolve: {
    alias: {
      interlocking: resolve(__dirname, 'node_modules/interlocking/src')
    }
  },
  optimizeDeps: {
    include: ['maplibre-gl', 'jszip', 'papaparse'],
    // interlocking ships raw .ts; let vite transform it as source
    exclude: ['interlocking']
  }
})
