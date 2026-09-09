import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as viteBuild } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'node_modules', '.tmp')
const outfile = path.join(outDir, 'warehouse-stock-verify.mjs')
const entry = path.join(root, 'src', 'lib', 'warehouse', 'stock.verify.ts')

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
if ((run.status ?? 1) !== 0) process.exit(run.status ?? 1)

const downloads = path.join(process.env.USERPROFILE ?? '', 'Downloads')
const sample = existsSync(downloads)
  ? readdirSync(downloads).find((name) =>
      /Masmarulez_.*20260909.*\.xlsx$/i.test(name),
    )
  : null
if (!sample) {
  console.log('warehouse-sheet-sync xlsx: skip (sample file not found)')
  process.exit(0)
}

const XLSX = await import('xlsx')
const workbook = XLSX.read(readFileSync(path.join(downloads, sample)), {
  type: 'buffer',
  cellDates: true,
})
const sheetName = workbook.SheetNames[0]
if (!sheetName) {
  console.error('warehouse-sheet-sync xlsx: 시트를 찾지 못했습니다.')
  process.exit(1)
}
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
  header: 1,
  blankrows: false,
  defval: '',
  raw: false,
})
const dataRows = rows.slice(1).filter(
  (row) =>
    Array.isArray(row) && row.some((cell) => String(cell ?? '').trim() !== ''),
)
console.log(
  `warehouse-sheet-sync xlsx: ${sample} ${dataRows.length}행`,
)
if (dataRows.length !== 2028) {
  console.error(`예상 2,028행과 다릅니다: ${dataRows.length}`)
  process.exit(1)
}
console.log('warehouse-sheet-sync xlsx: ok')
