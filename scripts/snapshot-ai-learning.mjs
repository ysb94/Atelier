import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

const root = path.resolve(import.meta.dirname, '..')
const snapshotName = (process.argv[2] || 'pre-20260826').trim()
if (!/^[a-zA-Z0-9_-]+$/.test(snapshotName)) {
  throw new Error('snapshot name must contain only letters, numbers, - or _')
}
const outDir = path.join(root, 'docs', 'backups')
const xlsxPath = path.join(outDir, `ai-learning-${snapshotName}.xlsx`)
const countsPath = path.join(outDir, `ai-learning-${snapshotName}.counts.json`)

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

const TABLES = [
  'invoice_product_name_maps',
  'invoice_item_name_rules',
  'invoice_item_name_rule_components',
  'ai_feature_routes',
  'ai_recommendation_feedback',
  'ai_item_name_recommendation_feedback',
  'ai_item_name_recommendation_feedback_components',
  'ai_recommendation_cache',
  'ai_usage_logs',
  'ai_model_pricing',
]

const workbook = XLSX.utils.book_new()
const counts = {
  createdAt: new Date().toISOString(),
  note:
    '캐시는 복구 대상이 아니다. 비로그인 키는 RLS로 행이 비어 있을 수 있다.',
  tables: {},
}

const PAGE = 1000
const usedSheetNames = new Set()

function uniqueSheetName(table) {
  const base = table.slice(0, 31)
  if (!usedSheetNames.has(base)) {
    usedSheetNames.add(base)
    return base
  }
  for (let index = 2; ; index += 1) {
    const suffix = `_${index}`
    const candidate = `${table.slice(0, 31 - suffix.length)}${suffix}`
    if (!usedSheetNames.has(candidate)) {
      usedSheetNames.add(candidate)
      return candidate
    }
  }
}

for (const table of TABLES) {
  const rows = []
  let total = null
  let errorMessage = null
  for (let from = 0; ; from += PAGE) {
    const { data, error, count } = await supabase
      .from(table)
      .select('*', { count: 'exact' })
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
  counts.tables[table] = {
    fetched: rows.length,
    count: total ?? rows.length,
    error: errorMessage,
  }
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(rows.length ? rows : [{ _empty: true }]),
    uniqueSheetName(table),
  )
}

mkdirSync(outDir, { recursive: true })
const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
writeFileSync(xlsxPath, bytes)
writeFileSync(countsPath, `${JSON.stringify(counts, null, 2)}\n`)
console.log(JSON.stringify({ xlsxPath, countsPath, counts }, null, 2))
