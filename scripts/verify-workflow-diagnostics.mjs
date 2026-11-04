import { mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { build } from 'esbuild'

const root = process.cwd(), dir = path.join(root, '.tmp/workflow-diagnostics')
await mkdir(dir, { recursive: true })
const outfile = path.join(dir, 'verify.mjs')
await build({
  entryPoints: ['src/lib/diagnostics/workflow-trace.verify.ts'], outfile, bundle: true, platform: 'node', format: 'esm',
  packages: 'external', alias: { '@': path.join(root, 'src') }, define: { 'import.meta.env': '{"DEV":false}' }, logLevel: 'warning',
})
const run = spawnSync(process.execPath, [outfile], { stdio: 'inherit' })
if (run.status !== 0) process.exit(run.status ?? 1)
await import('./verify-workflow-diagnostics-browser.mjs')
