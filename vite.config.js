import { defineConfig } from 'vite'
import { resolve } from 'path'
import { execSync } from 'child_process'

let version
try {
  version = execSync('git describe --tags --long --always').toString().trim()
} catch {
  version = '0.0.0-development'
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
    port: 8080,
    open: true,
    host: true,
    proxy: {
      // The local music-student stack, reached same-origin so the dev examples
      // work whatever port vite lands on. cafe-car's CORS allowlist names one
      // fixed origin, and vite silently falls through to 8081+ when 8080 is
      // taken by another project — a direct localhost:8000 fetch then dies on
      // CORS. Proxying sidesteps the allowlist entirely.
      '/rt-local': {
        target: 'http://localhost:8000',
        rewrite: p => p.replace(/^\/rt-local/, '')
      }
    }
  },
  css: {
    postcss: './postcss.config.js'
  },
  optimizeDeps: {
    include: ['maplibre-gl', 'jszip', 'papaparse']
  }
})
