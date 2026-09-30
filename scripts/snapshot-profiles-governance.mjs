import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

const root = path.resolve(import.meta.dirname, '..')
const outDir = path.join(root, 'docs', 'backups')
const xlsxPath = path.join(outDir, 'profiles-pre-position-governance-20260930.xlsx')
const countsPath = path.join(outDir, 'profiles-pre-position-governance-20260930.counts.json')

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

async function fetchAll(table, columns, orderColumn) {
  const rows = []
  let total = null
  let errorMessage = null
  for (let from = 0; ; from += PAGE) {
    const { data, error, count } = await supabase
      .from(table)
      .select(columns, { count: 'exact' })
      .order(orderColumn, { ascending: true })
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

const profiles = await fetchAll(
  'profiles',
  'id, company_id, department_id, position, is_admin, status, approved_by, approved_at',
  'id',
)
const departments = await fetchAll(
  'departments',
  'id, company_id, name, sort_order, is_active',
  'sort_order',
)
const capabilities = await fetchAll(
  'profile_capabilities',
  'profile_id, capability, created_at',
  'profile_id',
)

const workbook = XLSX.utils.book_new()
for (const [name, result] of [
  ['profiles', profiles],
  ['departments', departments],
  ['profile_capabilities', capabilities],
]) {
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(result.rows.length ? result.rows : [{ _empty: true }]),
    name,
  )
}

const counts = {
  createdAt: new Date().toISOString(),
  note: '직책·소속 변경 권한을 운영지원팀으로 좁히기 직전 스냅샷. 이메일·이름·남길 말은 넣지 않는다.',
  tables: {
    profiles: { fetched: profiles.rows.length, count: profiles.total, error: profiles.error },
    departments: {
      fetched: departments.rows.length,
      count: departments.total,
      error: departments.error,
    },
    profile_capabilities: {
      fetched: capabilities.rows.length,
      count: capabilities.total,
      error: capabilities.error,
    },
  },
}

if (profiles.error || departments.error || capabilities.error) {
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
      profiles: profiles.rows.length,
      departments: departments.rows.length,
      capabilities: capabilities.rows.length,
    },
    null,
    2,
  ),
)
