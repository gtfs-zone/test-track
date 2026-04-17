import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
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
