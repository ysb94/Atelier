import { existsSync, mkdirSync, readFileSync } from 'node:fs'
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

const sample = path.join(
  process.env.USERPROFILE ?? '',
  'Downloads',
  '현재 260826 기준 창고 자리.xlsx',
)
if (!existsSync(sample)) {
  console.log('warehouse-stock xlsx: skip (sample file not found)')
  process.exit(0)
}

const XLSX = await import('xlsx')
let workbook
try {
  workbook = XLSX.read(readFileSync(sample), { type: 'buffer', cellDates: true })
} catch (error) {
  console.log(
    `warehouse-stock xlsx: skip (${error instanceof Error ? error.message : 'unreadable'})`,
  )
  process.exit(0)
}
const sheetName =
  workbook.SheetNames.find(
    (name) => name.replace(/\s+/g, '').toLocaleLowerCase('ko-KR') === '상품업로드',
  ) ?? workbook.SheetNames[0]
if (!sheetName) {
  console.error('warehouse-stock xlsx: 시트를 찾지 못했습니다.')
  process.exit(1)
}
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
  header: 1,
  blankrows: false,
  defval: '',
  raw: false,
})
const dataRows = rows.slice(1).filter((row) =>
  Array.isArray(row) && row.some((cell) => String(cell ?? '').trim() !== ''),
)
if (dataRows.length !== 3459) {
  console.error(
    `warehouse-stock xlsx: expected 3459 data rows, got ${dataRows.length}`,
  )
  process.exit(1)
}
console.log('warehouse-stock xlsx: 3459 rows preserved')
process.exit(0)
