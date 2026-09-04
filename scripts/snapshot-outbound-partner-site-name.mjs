import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

const root = path.resolve(import.meta.dirname, '..')
const snapshotName = (process.argv[2] || 'pre-site-name-20260904').trim()
if (!/^[a-zA-Z0-9_-]+$/.test(snapshotName)) {
  throw new Error('snapshot name must contain only letters, numbers, - or _')
}
const outDir = path.join(root, 'docs', 'backups')
const xlsxPath = path.join(outDir, `outbound-partner-${snapshotName}.xlsx`)
const countsPath = path.join(
  outDir,
  `outbound-partner-${snapshotName}.counts.json`,
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

const workbook = XLSX.utils.book_new()
const counts = {
  createdAt: new Date().toISOString(),
  note: '지점명이 빈 대표 줄에 지점명을 채우기 직전의 출고업체 원장 스냅샷.',
  tables: {},
}

const PAGE = 1000

async function fetchAll(table, columns = '*') {
  const rows = []
  let total = null
  let errorMessage = null
  for (let from = 0; ; from += PAGE) {
    const { data, error, count } = await supabase
      .from(table)
      .select(columns, { count: 'exact' })
      .range(from, from + PAGE - 1)
    if (error) {
      errorMessage = error.message
      break
    }
    total = count ?? total
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return { rows, total, errorMessage }
}

for (const table of [
  'code_usage_targets',
  'outbound_partner_groups',
  'code_usage_target_aliases',
]) {
  const result = await fetchAll(table)
  counts.tables[table] = {
    fetched: result.rows.length,
    count: result.total ?? result.rows.length,
    error: result.errorMessage,
  }
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      result.rows.length ? result.rows : [{ _empty: true }],
    ),
    table.slice(0, 31),
  )
}

mkdirSync(outDir, { recursive: true })
writeFileSync(xlsxPath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
writeFileSync(countsPath, `${JSON.stringify(counts, null, 2)}\n`)
console.log(JSON.stringify({ xlsxPath, countsPath, counts }, null, 2))
