import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

const root = path.resolve(import.meta.dirname, '..')
const snapshotName = (process.argv[2] || 'pre-tidy-rows-20260929').trim()
if (!/^[a-zA-Z0-9_-]+$/.test(snapshotName)) {
  throw new Error('snapshot name must contain only letters, numbers, - or _')
}
const outDir = path.join(root, 'docs', 'backups')
const xlsxPath = path.join(outDir, `cargo-inbound-${snapshotName}.xlsx`)
const countsPath = path.join(outDir, `cargo-inbound-${snapshotName}.counts.json`)

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

async function fetchAll(table, orderColumn) {
  const rows = []
  let total = null
  let errorMessage = null
  for (let from = 0; ; from += PAGE) {
    const { data, error, count } = await supabase
      .from(table)
      .select('*', { count: 'exact' })
      .order(orderColumn, { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) {
      errorMessage = error.message
      break
    }
    total = count ?? total
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return { rows, total: total ?? rows.length, error: errorMessage }
}

const shipments = await fetchAll('cargo_inbound_shipments', 'shipped_on')
const lines = await fetchAll('cargo_inbound_lines', 'shipment_id')

const workbook = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet(
    shipments.rows.length ? shipments.rows : [{ _empty: true }],
  ),
  'cargo_inbound_shipments',
)
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet(lines.rows.length ? lines.rows : [{ _empty: true }]),
  'cargo_inbound_lines',
)

const counts = {
  createdAt: new Date().toISOString(),
  note: '창고정리용 저장 행 테이블을 추가하기 직전의 화문 입고 원장 스냅샷.',
  tables: {
    cargo_inbound_shipments: {
      fetched: shipments.rows.length,
      count: shipments.total,
      error: shipments.error,
    },
    cargo_inbound_lines: {
      fetched: lines.rows.length,
      count: lines.total,
      error: lines.error,
    },
  },
}

if (shipments.error || lines.error) {
  console.error(JSON.stringify(counts, null, 2))
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
writeFileSync(xlsxPath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
writeFileSync(countsPath, `${JSON.stringify(counts, null, 2)}\n`)
console.log(
  JSON.stringify(
    {
      xlsxPath,
      countsPath,
      shipments: shipments.rows.length,
      lines: lines.rows.length,
    },
    null,
    2,
  ),
)
