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
    host: true
  },
  css: {
    postcss: './postcss.config.js'
  },
  optimizeDeps: {
    include: ['maplibre-gl', 'jszip', 'papaparse']
  }
})
