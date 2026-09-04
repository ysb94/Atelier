import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

const root = path.resolve(import.meta.dirname, '..')
const snapshotName = (process.argv[2] || 'pre-runs-20260904').trim()
if (!/^[a-zA-Z0-9_-]+$/.test(snapshotName)) {
  throw new Error('snapshot name must contain only letters, numbers, - or _')
}
const outDir = path.join(root, 'docs', 'backups')
const xlsxPath = path.join(outDir, `barcode-data-entry-${snapshotName}.xlsx`)
const countsPath = path.join(
  outDir,
  `barcode-data-entry-${snapshotName}.counts.json`,
)

const env = Object.fromEntries(
  readFileSync(path.join(root, '.env.local'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => {
      const at = line.indexOf('=')
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()]
    }),
)

const supabase = createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_PUBLISHABLE_KEY,
)

if (env.VITE_DEV_LOGIN_EMAIL && env.VITE_DEV_LOGIN_PASSWORD) {
  const { error } = await supabase.auth.signInWithPassword({
    email: env.VITE_DEV_LOGIN_EMAIL,
    password: env.VITE_DEV_LOGIN_PASSWORD,
  })
  if (error) {
    console.error(`dev login failed: ${error.message}`)
    process.exit(1)
  }
}

const PAGE = 1000
const rows = []
let total = null
let errorMessage = null

for (let from = 0; ; from += PAGE) {
  const { data, error, count } = await supabase
    .from('outbound_shipments')
    .select('*', { count: 'exact' })
    .eq('source', 'bulk')
    .like('source_ref', 'barcode-data-entry:%')
    .order('shipped_on', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + PAGE - 1)
  if (error) {
    errorMessage = error.message
    break
  }
  total = count ?? total
  rows.push(...(data ?? []))
  if (!data || data.length < PAGE) break
}

const workbook = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet(rows.length ? rows : [{ _empty: true }]),
  'outbound_shipments',
)

const counts = {
  createdAt: new Date().toISOString(),
  note: 'source_ref를 등록 ID 단위(barcode-data-entry:<run_id>)로 바꾸기 직전의 바코드 출고 데이터입력 원장 스냅샷.',
  tables: {
    outbound_shipments: {
      filter: "source = 'bulk' and source_ref like 'barcode-data-entry:%'",
      fetched: rows.length,
      count: total ?? rows.length,
      error: errorMessage,
    },
  },
}

mkdirSync(outDir, { recursive: true })
writeFileSync(xlsxPath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
writeFileSync(countsPath, `${JSON.stringify(counts, null, 2)}\n`)
console.log(JSON.stringify({ xlsxPath, countsPath, counts }, null, 2))
