import { mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'node_modules', '.tmp')
const outfile = path.join(outDir, 'sabangnet-urls-verify.mjs')
mkdirSync(outDir, { recursive: true })
await build({ root, configFile: false, logLevel: 'warn', resolve: { alias: { '@': path.join(root, 'src') } }, build: { ssr: path.join(root, 'src/lib/codes/sabangnet-url-import.verify.ts'), outDir, emptyOutDir: false, minify: false, rollupOptions: { output: { entryFileNames: path.basename(outfile) } } } })
const run = spawnSync(process.execPath, [outfile], { cwd: root, stdio: 'inherit' })
process.exit(run.status ?? 1)
