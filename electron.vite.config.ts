import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Single source of truth for the version shown in the UI footer — read from
// package.json at build time so it tracks every release instead of drifting.
const appVersion = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')).version as string

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared'), '@main': resolve('src/main') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    // Renderer is sandboxed, so the preload must be CommonJS. In this
    // "type": "module" project a CJS file needs the .cjs extension.
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } }
  },
  renderer: {
    plugins: [react()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    define: { __APP_VERSION__: JSON.stringify(appVersion) },
    server: { port: 8100, strictPort: true }
  }
})
