import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { mdPriceBrowserPlugin } from './scripts/md-price-browser/vite-plugin.ts'
import { windowsOutputCleanupPlugin } from './scripts/vite-windows-output-cleanup.ts'

const spin360Prefix = '/__atelier-spin360'
const spin360Service = 'http://127.0.0.1:4320'
const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export default defineConfig(({command, isPreview, mode}) => ({
  define: {
    'import.meta.env.VITE_ATELIER_RELEASE': JSON.stringify(process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA ?? 'local'),
    'import.meta.env.VITE_ATELIER_BUILT_AT': JSON.stringify(new Date().toISOString()),
  },
  plugins: [windowsOutputCleanupPlugin(), react(), tailwindcss(), mdPriceBrowserPlugin(loadEnv(mode,process.cwd(),''))],
  build: {
    rolldownOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        viewer: fileURLToPath(new URL('./viewer.html', import.meta.url)),
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: command === 'serve' && !isPreview ? {
      [`${spin360Prefix}/`]: {
        target: spin360Service,
        changeOrigin: true,
        rewrite: url => url.slice(spin360Prefix.length),
        bypass(request) {
          const { host, origin } = request.headers
          // The dev server also listens on the LAN. The paid tool stays loopback-only.
          if (!loopbackAddresses.has(request.socket.remoteAddress ?? '')
            || !host || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)
            || (origin && origin !== `http://${host}`)
            || (request.method === 'POST' && !origin)) return false
        },
        configure(proxy) {
          proxy.on('proxyReq', (forwarded, request) => {
            if (request.headers.origin) forwarded.setHeader('Origin', spin360Service)
          })
        },
      },
    } : undefined,
    watch: { ignored: ['**/.venv-md-price/**', '**/.tmp/**', '**/dev-tools/structure-map/**', '**/dev-tools/ai-workflow/**'] },
  },
}))
