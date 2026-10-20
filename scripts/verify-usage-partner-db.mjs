// Disposable PostgreSQL verification. No URL, credentials, or production connection.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const index = process.argv.indexOf('--pglite-path')
const runtime =
  index >= 0
    ? process.argv[index + 1]
    : 'dev-tools/ai-workflow/.state/usage-test/node_modules/@electric-sql/pglite/dist/index.js'
const { PGlite } = await import(pathToFileURL(path.resolve(runtime)).href)
const db = new PGlite()
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let checks = 0
const sql = (query, params = []) => db.query(query, params)
const as = async (n) => {
  await sql("select set_config('request.jwt.claim.sub',$1,false)", [id(n)])
}
const rejects = async (fn) => {
  await assert.rejects(fn)
  checks++
}
const readValue = async (target = 30, field = 102) =>
  (
    await sql(
      'select value from public.usage_partner_values where usage_target_id=$1 and field_id=$2',
      [id(target), id(field)],
    )
  ).rows[0]?.value
const columns = () => [
  {
    id: id(100),
    kind: 'common',
    sourceKey: 'code',
    label: '88코드',
    description: '원본',
    valueType: 'text',
    visible: true,
    sortOrder: 0,
  },
  {
    id: id(101),
    kind: 'operation',
    sourceKey: 'status',
    label: '상태',
    description: '업체 상태',
    valueType: 'text',
    visible: true,
    sortOrder: 1,
  },
  {
    id: id(102),
    kind: 'private',
    sourceKey: null,
    label: '상품명',
    description: '업체 판매 상품명',
    valueType: 'text',
    visible: true,
    sortOrder: 2,
  },
  {
    id: id(103),
    kind: 'private',
    sourceKey: null,
    label: '금액',
    description: '업체 값',
    valueType: 'number',
    visible: true,
    sortOrder: 3,
  },
  {
    id: id(104),
    kind: 'private',
    sourceKey: null,
    label: '시작일',
    description: '업체 값',
    valueType: 'date',
    visible: true,
    sortOrder: 4,
  },
]
const saveColumns = (target, fields) =>
  sql('select * from public.save_usage_partner_columns($1,$2,$3::jsonb)', [
    id(20),
    id(target),
    JSON.stringify(fields),
  ])
const saveValues = (target, values, code = 40, brand = 20) =>
  sql('select public.save_usage_partner_values($1,$2,$3,$4::jsonb)', [
    id(brand),
    id(target),
    id(code),
    JSON.stringify(values),
  ])
const fingerprint = async () => {
  const result = {}
  for (const table of [
    'styles',
    'product_codes',
    'product_code_components',
    'code_usage_targets',
    'code_usage_assignments',
    'usage_code_columns',
  ]) {
    result[table] = (
      await sql(
        `select md5(coalesce(string_agg(to_jsonb(t)::text,',' order by to_jsonb(t)::text),'')) as hash from public.${table} t`,
      )
    ).rows[0].hash
  }
  return result
}

try {
  await db.exec(`
    create role authenticated; create role anon; create schema auth; create schema app;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.profiles(id uuid primary key,display_name text,status text,company_id uuid,is_admin boolean default false,has_capability boolean default true);
    create table public.brands(id uuid primary key,company_id uuid);
    create table public.brand_members(brand_id uuid,profile_id uuid,is_lead boolean default false,primary key(brand_id,profile_id));
    create function app.is_admin() returns boolean language sql stable security definer set search_path='' as $$select coalesce((select is_admin from public.profiles where id=auth.uid() and status='active'),false)$$;
    create function app.is_brand_lead(b uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.brand_members where brand_id=b and profile_id=auth.uid() and is_lead)$$;
    create function app.can_read_brand(b uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and status='active')$$;
    create function app.can_edit_brand(b uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and status='active' and has_capability)$$;
    create table public.code_usage_targets(id uuid primary key,brand_id uuid,name text,unique(brand_id,id));
    create table public.product_codes(id uuid primary key,brand_id uuid,code text,name text,unique(brand_id,id));
    create table public.code_usage_assignments(id uuid primary key,brand_id uuid,product_code_id uuid,usage_target_id uuid,status text,unique(brand_id,product_code_id,usage_target_id));
    create table public.styles(id uuid primary key,brand_id uuid,style_no text,name text);
    create table public.product_code_components(product_code_id uuid,style_id uuid,qty integer);
    create table public.usage_code_columns(id uuid primary key,brand_id uuid,system_key text,label text,sort_order integer);
    grant usage on schema public,app,auth to authenticated,anon;
    grant select on all tables in schema public to authenticated;
  `)
  await sql('insert into public.brands values($1,$2),($3,$4)', [
    id(20),
    id(10),
    id(21),
    id(11),
  ])
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    await sql('insert into public.profiles values($1,$2,$3,$4,$5,true)', [
      id(n),
      `검증 직원 ${n}`,
      n === 7 ? 'disabled' : 'active',
      id(n === 5 ? 11 : 10),
      n === 1,
    ])
    await sql('insert into public.brand_members values($1,$2,$3)', [
      id(n === 5 ? 21 : 20),
      id(n),
      n === 2,
    ])
  }
  for (const [target, brand] of [
    [30, 20],
    [31, 20],
    [32, 21],
  ])
    await sql('insert into public.code_usage_targets values($1,$2,$3)', [
      id(target),
      id(brand),
      `검증 업체 ${target}`,
    ])
  await sql(
    "insert into public.product_codes values($1,$2,'8800000000001','공통 코드명'),($3,$4,'8800000000002','다른 브랜드 코드')",
    [id(40), id(20), id(41), id(21)],
  )
  for (const [n, target, brand, code] of [
    [50, 30, 20, 40],
    [51, 31, 20, 40],
    [52, 32, 21, 41],
  ])
    await sql(
      "insert into public.code_usage_assignments values($1,$2,$3,$4,'active')",
      [id(n), id(brand), id(code), id(target)],
    )
  await sql(
    "insert into public.styles values($1,$2,'M001-BLACK-S','물류 상품명'),($3,$2,'M002-BLACK-M','다른 SKU')",
    [id(60), id(20), id(61)],
  )
  await sql(
    'insert into public.product_code_components values($1,$2,2),($1,$3,1)',
    [id(40), id(60), id(61)],
  )
  await sql(
    "insert into public.usage_code_columns values($1,$2,'productName','기존 상품명',0),($3,$2,null,'기존 미확인 항목',1)",
    [id(70), id(20), id(71)],
  )
  const before = await fingerprint()
  await db.exec(
    await fs.readFile(
      'supabase/migrations/20261020065641_usage_partner_headers.sql',
      'utf8',
    ),
  )
  assert.deepEqual(await fingerprint(), before)
  checks++
  await db.exec('set role authenticated')
  await as(1)
  await sql('select public.save_usage_partner_editors($1,$2,$3::uuid[])', [
    id(20),
    id(30),
    [id(3), id(6)],
  ])
  await saveColumns(30, columns())
  await saveColumns(31, columns())
  await as(3)
  await saveValues(30, {
    [id(102)]: '무신사 상품명',
    [id(103)]: 0,
    [id(104)]: '2028-02-29',
  })
  assert.equal(await readValue(), '무신사 상품명')
  checks++
  assert.equal(await readValue(30, 103), 0)
  checks++
  await rejects(() => saveValues(31, { [id(102)]: '다른 업체 덮어쓰기' }))
  await rejects(() => saveValues(32, { [id(102)]: '다른 브랜드' }, 41, 21))
  await rejects(() => saveValues(30, { [id(100)]: '공통 값 덮어쓰기' }))
  await rejects(() =>
    sql(
      'insert into public.usage_partner_values values($1,$2,$3,$4,$5::jsonb,now())',
      [id(20), id(30), id(40), id(100), JSON.stringify('직접 REST 우회')],
    ),
  )
  await rejects(() =>
    sql('select public.save_usage_partner_editors($1,$2,$3::uuid[])', [
      id(20),
      id(31),
      [id(3)],
    ]),
  )
  await rejects(() =>
    sql('insert into public.usage_partner_editors values($1,$2,$3)', [
      id(20),
      id(31),
      id(3),
    ]),
  )
  await rejects(() =>
    sql(
      'update public.usage_partner_values set usage_target_id=$1 where usage_target_id=$2',
      [id(31), id(30)],
    ),
  )
  const hidden = columns()
  hidden[2] = { ...hidden[2], visible: false, label: '무신사 상품명' }
  await saveColumns(30, hidden)
  assert.equal(await readValue(), '무신사 상품명')
  checks++
  hidden[2].visible = true
  await saveColumns(30, hidden)
  assert.equal(await readValue(), '무신사 상품명')
  checks++
  assert.equal(
    (
      await sql(
        'select label from public.usage_partner_columns where usage_target_id=$1 and id=$2',
        [id(31), id(102)],
      )
    ).rows[0].label,
    '상품명',
  )
  checks++
  await rejects(() =>
    saveColumns(
      30,
      columns().filter((c) => c.id !== id(102)),
    ),
  )
  await rejects(() =>
    saveColumns(
      30,
      columns().map((c) =>
        c.id === id(102) ? { ...c, valueType: 'number' } : c,
      ),
    ),
  )
  await rejects(() =>
    saveColumns(
      30,
      columns().map((c) =>
        c.id === id(100) ? { ...c, sourceKey: 'name' } : c,
      ),
    ),
  )
  await rejects(() =>
    saveColumns(
      30,
      columns().map((c) => (c.id === id(100) ? { ...c, visible: false } : c)),
    ),
  )
  await rejects(() =>
    sql('delete from public.usage_partner_columns where usage_target_id=$1', [
      id(30),
    ]),
  )
  await rejects(() =>
    sql(
      'update public.usage_partner_columns set source_key=$1 where usage_target_id=$2 and id=$3',
      ['name', id(30), id(100)],
    ),
  )
  await rejects(() => saveValues(30, { [id(103)]: 'not a number' }))
  await rejects(() =>
    sql('select public.save_usage_partner_values($1,$2,$3,$4::jsonb)', [
      id(20),
      id(30),
      id(40),
      `{"${id(103)}":1e4000}`,
    ]),
  )
  await rejects(() =>
    saveColumns(
      30,
      columns().map((c) => (c.id === id(102) ? { ...c, label: '상_태' } : c)),
    ),
  )
  await rejects(() => saveValues(30, { [id(104)]: '2026-02-31' }))
  await rejects(() => saveValues(30, { [id(104)]: '2026-2-1' }))
  await rejects(() => saveValues(30, { [id(102)]: 'x'.repeat(4001) }))
  await rejects(() =>
    saveValues(30, {
      [id(102)]: '원치 않는 일부 저장',
      [id(100)]: '공통 덮어쓰기',
    }),
  )
  assert.equal(await readValue(), '무신사 상품명')
  checks++
  await as(4)
  assert.equal(await readValue(), '무신사 상품명')
  checks++
  await rejects(() => saveValues(30, { [id(102)]: '열람자 수정' }))
  await rejects(() => saveColumns(30, columns()))
  const access = (
    await sql('select public.get_usage_partner_access($1,$2) as access', [
      id(20),
      id(30),
    ])
  ).rows[0].access
  assert.equal(access.canEdit, false)
  checks++
  await as(5)
  assert.equal(
    (await sql('select * from public.usage_partner_values')).rows.length,
    0,
  )
  checks++
  await rejects(() =>
    sql('select public.get_usage_partner_access($1,$2)', [id(20), id(30)]),
  )
  await as(1)
  await rejects(() =>
    sql('select public.save_usage_partner_editors($1,$2,$3::uuid[])', [
      id(20),
      id(30),
      [id(5)],
    ]),
  )
  await rejects(() =>
    sql('select public.save_usage_partner_editors($1,$2,$3::uuid[])', [
      id(20),
      id(30),
      [id(7)],
    ]),
  )
  await rejects(() =>
    sql('select public.save_usage_partner_editors($1,$2,$3::uuid[])', [
      id(20),
      id(32),
      [],
    ]),
  )
  await sql('select public.save_usage_partner_editors($1,$2,$3::uuid[])', [
    id(20),
    id(30),
    [id(3)],
  ])
  await as(6)
  await rejects(() => saveValues(30, { [id(102)]: '권한 회수 뒤 수정' }))
  await db.exec('reset role')
  await sql(
    'delete from public.brand_members where brand_id=$1 and profile_id=$2',
    [id(20), id(3)],
  )
  await db.exec('set role authenticated')
  await as(3)
  await rejects(() => saveValues(30, { [id(102)]: '브랜드 멤버 해제 뒤 수정' }))
  await as(2)
  await saveValues(30, { [id(102)]: '브랜드 책임자 수정' })
  assert.equal(await readValue(), '브랜드 책임자 수정')
  checks++
  await db.exec('reset role')
  assert.deepEqual(await fingerprint(), before)
  checks++
  const functions = (
    await sql(
      "select proname,prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like '%usage_partner%'",
    )
  ).rows
  assert.ok(functions.length >= 5 && functions.every((f) => !f.prosecdef))
  checks++
  assert.equal(
    (
      await sql(
        "select has_function_privilege('anon','public.save_usage_partner_values(uuid,uuid,uuid,jsonb)','execute') as allowed",
      )
    ).rows[0].allowed,
    false,
  )
  checks++
  console.log(
    `PASS ${checks} PostgreSQL/RLS checks; shared-data fingerprints unchanged; production not connected`,
  )
} finally {
  await db.close()
}
