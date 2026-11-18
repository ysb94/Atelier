import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = await PGlite.create()
const company = 'e0000000-0000-4000-8000-000000000001'
const planning = 'ced99f89-ea80-4eeb-8f03-272bf72f5db1'
const author = crypto.randomUUID()
const other = crypto.randomUUID()
const operator = 'd0000000-0000-4000-8000-000000000001'
const color = crypto.randomUUID()
const colors = JSON.stringify([{ id: color, name: '블랙' }])
const role = async (id, name = 'authenticated') => {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  await db.exec(`set role ${name}`)
}
const scalar = async (sql, args) => Object.values((await db.query(sql, args)).rows[0])[0]

try {
  for (const file of [
    'supabase/tests/department_work_fixture.sql',
    'supabase/migrations/20261027044909_department_work_access.sql',
    'supabase/migrations/20261118062623_draft_information_temporary.sql',
  ]) await db.exec(await readFile(file, 'utf8'))
  await db.query('insert into public.companies(id) values($1)', [company])
  await db.query("insert into public.departments(id,company_id,name,is_active) values($1,$2,'기획팀',true)", [planning, company])
  for (const id of [author, other, operator]) {
    await db.query("insert into public.profiles(id,company_id,department_id,display_name,status,is_admin,position) values($1,$2,$3,$4,'active',false,'')",
      [id, company, planning, id])
  }
  await role(author)
  const original = { colorSpecs: { [color]: { weight: '250g', sizeConfirmed: true } }, coating: { note: '기존 공통 문서' } }
  const draft = await scalar("select public.save_product_draft($1,null,null,$2,$3,'[]')", [company, { nameKo: '임시 저장 검증', specs: original }, colors])
  const specs = () => scalar('select specs from public.product_drafts where id=$1', [draft])
  const revision = () => scalar('select updated_at::text from public.product_drafts where id=$1', [draft])
  const list = async () => (await db.query('select field,revision,edits from public.draft_information_temporary order by field')).rows
  const upsert = (editor, field, colorId, version, edits) => db.query(
    `insert into public.draft_information_temporary (draft_id,editor_id,field,color_id,revision,edits)
     values ($1,$2,$3,$4,$5,$6) on conflict (draft_id,editor_id,field,color_id)
     do update set revision=excluded.revision, edits=excluded.edits`, [draft, editor, field, colorId, version, edits])
  const confirm = (version, expectedUpdatedAt, values) => scalar(
    "select public.save_product_draft_information($1,null,$2,$3,$4,'[]',$5)",
    [company, draft, { nameKo: '임시 저장 검증', specs: values, expectedUpdatedAt }, colors, version])

  const sizeDraft = { weight: { source: '250g', text: '270g' } }
  const docDraft = { specDoc: { source: '기존 공통 문서', text: '임시 공통 문서' } }
  const first = crypto.randomUUID()
  const recent = crypto.randomUUID()
  const docRevision = crypto.randomUUID()
  const before = await specs()
  await upsert(author, 'size', color, first, sizeDraft)
  await upsert(author, 'specDoc', null, crypto.randomUUID(), docDraft)
  await upsert(author, 'specDoc', null, docRevision, docDraft)
  assert.deepEqual(await specs(), before)
  assert.deepEqual((await list()).map(row => row.revision), [first, docRevision])
  await assert.rejects(upsert(author, 'fabric', crypto.randomUUID(), crypto.randomUUID(), {}), { code: '42501' })
  await role(other)
  assert.deepEqual(await list(), [])
  await assert.rejects(upsert(other, 'size', color, crypto.randomUUID(), sizeDraft), { code: '42501' })
  await role(operator)
  assert.deepEqual(await list(), [], 'Existing operators can edit the draft but cannot read someone else’s working copy')
  await role('', 'anon')
  await assert.rejects(list(), { code: '42501' })
  await role(author)

  await upsert(author, 'size', color, recent, { weight: { source: '250g', text: '280g' } })
  const finalized = { ...before, colorSpecs: { [color]: { weight: '270g', sizeConfirmed: true } } }
  await assert.rejects(confirm(recent, '2000-01-01', finalized))
  assert.deepEqual(await specs(), before)
  assert.deepEqual((await list()).map(row => row.revision), [recent, docRevision])
  assert.equal(await confirm(first, await revision(), finalized), draft)
  assert.deepEqual(await specs(), finalized)
  assert.deepEqual((await list()).map(row => row.revision), [recent, docRevision], 'A newer temporary revision survives confirmation')
  assert.equal(await confirm(recent, await revision(), { ...finalized, colorSpecs: { [color]: { weight: '280g', sizeConfirmed: true } } }), draft)
  assert.deepEqual((await list()).map(row => row.revision), [docRevision], 'Confirmation clears only its own item and revision')
  await confirm(docRevision, await revision(), { ...await specs(), coating: { note: docDraft.specDoc.text }, specDocumentConfirmed: true })
  assert.deepEqual(await list(), [])
  assert.equal((await specs()).specDocumentConfirmed, true)
  console.log('Draft INFORMATION SQL: private working copies, atomic confirmation, conflicts and concurrent revisions passed')
} finally {
  await db.close()
}
