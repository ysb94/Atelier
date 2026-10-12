import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { mdPriceBrowserPlugin } from './scripts/md-price-browser/vite-plugin.ts'
import { windowsOutputCleanupPlugin } from './scripts/vite-windows-output-cleanup.ts'

export default defineConfig(({mode}) => ({
  plugins: [windowsOutputCleanupPlugin(), react(), tailwindcss(), mdPriceBrowserPlugin(loadEnv(mode,process.cwd(),''))],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    watch: { ignored: ['**/.venv-md-price/**', '**/.tmp/**'] },
  },
}))
