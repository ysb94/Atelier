import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

const root = path.resolve(import.meta.dirname, '..')
const snapshotName = (process.argv[2] || 'pre-select-20260826').trim()
if (!/^[a-zA-Z0-9_-]+$/.test(snapshotName)) {
  throw new Error('snapshot name must contain only letters, numbers, - or _')
}
const outDir = path.join(root, 'docs', 'backups')
const xlsxPath = path.join(outDir, `brand-fields-${snapshotName}.xlsx`)
const countsPath = path.join(outDir, `brand-fields-${snapshotName}.counts.json`)

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
  note: '선택형 항목 작업 직전 brand_fields와 관련 상품값 스냅샷.',
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

function stringifyJson(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

const fields = await fetchAll('brand_fields')
counts.tables.brand_fields = {
  fetched: fields.rows.length,
  count: fields.total ?? fields.rows.length,
  error: fields.errorMessage,
}
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet(fields.rows.length ? fields.rows : [{ _empty: true }]),
  'brand_fields',
)

const options = await fetchAll('brand_field_options')
counts.tables.brand_field_options = {
  fetched: options.rows.length,
  count: options.total ?? options.rows.length,
  error: options.errorMessage,
}
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet(
    options.rows.length ? options.rows : [{ _empty: true }],
  ),
  'brand_field_options',
)

const styles = await fetchAll(
  'styles',
  'id, brand_id, style_no, name, category, planner, designer, values, custom_fields',
)
const styleRows = styles.rows.map((row) => ({
  ...row,
  values: stringifyJson(row.values),
  custom_fields: stringifyJson(row.custom_fields),
}))
counts.tables.styles = {
  fetched: styles.rows.length,
  count: styles.total ?? styles.rows.length,
  error: styles.errorMessage,
}
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet(styleRows.length ? styleRows : [{ _empty: true }]),
  'styles_select_values',
)

mkdirSync(outDir, { recursive: true })
const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
writeFileSync(xlsxPath, bytes)
writeFileSync(countsPath, `${JSON.stringify(counts, null, 2)}\n`)
console.log(JSON.stringify({ xlsxPath, countsPath, counts }, null, 2))
