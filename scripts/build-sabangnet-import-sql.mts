import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { normalizeStyleNo } from '../src/lib/import/transform'

const BRAND_ID = 'b0000000-0000-4000-8000-000000000001'
const CHUNK = 200

const official = JSON.parse(
  readFileSync('node_modules/.tmp/sabangnet-official.json', 'utf8'),
) as {
  rows: Array<{ code: string; name: string; styleNos: string[] }>
}
const styles = JSON.parse(
  readFileSync('node_modules/.tmp/masmarulez-styles.json', 'utf8'),
) as Array<{ id: string; style_no: string }>

const byNo = new Map(
  styles.map((style) => [normalizeStyleNo(style.style_no), style.id]),
)

const rows = official.rows.map((row) => ({
  code: row.code,
  name: row.name,
  style_ids: row.styleNos
    .map((styleNo) => byNo.get(normalizeStyleNo(styleNo)))
    .filter((id): id is string => Boolean(id)),
}))

mkdirSync('node_modules/.tmp/sabangnet-sql', { recursive: true })
const files: string[] = []
for (let start = 0; start < rows.length; start += CHUNK) {
  const chunk = rows.slice(start, start + CHUNK)
  const payload = JSON.stringify(chunk).replace(/'/g, "''")
  const sql = `with incoming as (
  select *
  from jsonb_to_recordset('${payload}'::jsonb)
    as x(code text, name text, style_ids uuid[])
),
inserted as (
  insert into public.sabangnet_products (brand_id, code, name)
  select '${BRAND_ID}'::uuid, incoming.code, incoming.name
  from incoming
  returning id, code
)
insert into public.sabangnet_product_styles (
  brand_id, product_id, style_id, sort_order
)
select
  '${BRAND_ID}'::uuid,
  inserted.id,
  style_id,
  sort_order
from incoming
join inserted on inserted.code = incoming.code
cross join lateral unnest(incoming.style_ids) with ordinality
  as linked(style_id, sort_order);`
  const file = `node_modules/.tmp/sabangnet-sql/chunk-${String(start / CHUNK + 1).padStart(2, '0')}.sql`
  writeFileSync(file, sql)
  files.push(file)
}

console.log(
  JSON.stringify(
    {
      rows: rows.length,
      linked: rows.filter((row) => row.style_ids.length > 0).length,
      unlinked: rows.filter((row) => row.style_ids.length === 0).length,
      links: rows.reduce((sum, row) => sum + row.style_ids.length, 0),
      files,
    },
    null,
    2,
  ),
)
