import { mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as viteBuild } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'node_modules', '.tmp')
const outfile = path.join(outDir, 'barcode-outbound-data-entry-verify.mjs')
const entry = path.join(
  root,
  'src',
  'lib',
  'outbound',
  'barcode-outbound-data-entry.verify.ts',
)

mkdirSync(outDir, { recursive: true })

await viteBuild({
  root,
  configFile: false,
  logLevel: 'warn',
  resolve: {
    alias: {
      '@': path.join(root, 'src'),
    },
  },
  build: {
    ssr: entry,
    outDir,
    emptyOutDir: false,
    minify: false,
    rollupOptions: {
      output: {
        entryFileNames: path.basename(outfile),
      },
    },
  },
})

const run = spawnSync(process.execPath, [outfile], {
  cwd: root,
  stdio: 'inherit',
})
process.exit(run.status ?? 1)
