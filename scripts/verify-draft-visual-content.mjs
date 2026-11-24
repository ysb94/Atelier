import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = await PGlite.create()
const company = 'e0000000-0000-4000-8000-000000000001'
const planning = 'ced99f89-ea80-4eeb-8f03-272bf72f5db1'
const visualTeam = '7ac8b7a8-7f12-4f3e-a371-d2dac7e492f1'
const visualOne = crypto.randomUUID()
const visualTwo = crypto.randomUUID()
const author = crypto.randomUUID()
const other = crypto.randomUUID()
const outsider = crypto.randomUUID()
const operator = 'd0000000-0000-4000-8000-000000000001'
const black = crypto.randomUUID()
const ivory = crypto.randomUUID()
const colors = JSON.stringify([{ id: black, name: '블랙' }, { id: ivory, name: '아이보리' }])

async function role(id, name = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  await db.exec(`set role ${name}`)
}

try {
  for (const file of [
    'supabase/tests/department_work_fixture.sql',
    'supabase/migrations/20261027044909_department_work_access.sql',
    'supabase/migrations/20261118062623_draft_information_temporary.sql',
    'supabase/migrations/20261118071459_save_draft_colors.sql',
    'supabase/migrations/20261122161836_draft_visual_html.sql',
    'supabase/migrations/20261123053353_draft_visual_assignments_and_status.sql',
    'supabase/migrations/20261123062029_draft_shared_color_photos.sql',
  ]) await db.exec(await readFile(file, 'utf8'))
  const otherCompany = crypto.randomUUID()
  await db.query('insert into public.companies(id) values($1),($2)', [company, otherCompany])
  await db.query("insert into public.departments(id,company_id,name,is_active) values($1,$2,'기획팀',true)", [planning, company])
  for (const id of [author, other, operator, outsider]) {
    await db.query("insert into public.profiles(id,company_id,department_id,display_name,status,is_admin,position) values($1,$2,$3,$4,'active',false,'')",
      [id, id === outsider ? otherCompany : company, id === outsider ? null : planning, id])
  }
  await db.query("insert into public.departments(id,company_id,name,is_active) values($1,$2,'Visual',true)", [visualTeam, company])
  for (const id of [visualOne, visualTwo]) {
    await db.query("insert into public.profiles(id,company_id,department_id,display_name,status,is_admin) values($1,$2,$3,'Visual','active',false)",
      [id, company, visualTeam])
  }

  await role(author)
  const draft = (await db.query("select public.save_product_draft($1,null,null,$2,$3,'[]') id",
    [company, { nameKo: 'Visual HTML 검증', specs: { coating: { note: '원본' } } }, colors])).rows[0].id
  const save = async (changes, temporary = null) => (await db.query(
    'select kind,entry_key,revision,payload from public.save_draft_visual_content($1,$2,$3)',
    [draft, JSON.stringify(changes), temporary])).rows
  const list = async () => (await db.query(
    'select kind,entry_key,revision,payload from public.draft_visual_content where draft_id=$1 order by kind,entry_key', [draft])).rows
  const change = (kind, entry_key, payload, revision = null) => ({ kind, entry_key, payload, revision })
  const readShared = async () => (await db.query(
    'select updated_at::text revision, specs from public.product_drafts where id=$1', [draft])).rows[0]
  const saveColors = async (revision, photo) => db.query('select public.save_draft_colors($1,$2,$3)',
    [draft, revision, JSON.stringify([{ id: black, name: '블랙', imageChoice: photo ? 'Image' : 'None', photoUrl: photo }])])

  const temporary = crypto.randomUUID()
  await db.query("insert into public.draft_information_temporary(draft_id,editor_id,field,color_id,revision,edits) values($1,$2,'html',$3,$4,$5)",
    [draft, author, black, temporary, { html: { source: '', text: '<p>임시 원문</p>' } }])
  assert.deepEqual(await list(), [])
  await role(other)
  assert.deepEqual((await db.query('select * from public.draft_information_temporary')).rows, [])
  await assert.rejects(save([change('color-html', black, '<p>권한 없음</p>')]), { code: '42501' })
  await role(author)

  const [body, photo, vendor] = await save([
    change('color-html', black, '<p>블랙</p>\n'),
    change('color-photo', ivory, 'data:image/png;base64,YQ=='),
    change('vendor-html', '무신사', { top: '<header>상단</header>', bottom: '<footer>하단</footer>' }),
  ], temporary)
  assert.equal((await db.query('select count(*)::int n from public.draft_information_temporary')).rows[0].n, 0)
  await assert.rejects(save([change('color-html', crypto.randomUUID(), '다른 컬러')]), { code: '22023' })
  await assert.rejects(save([change('color-photo', black, 'https://example.com/image')]), { code: '23514' })
  await assert.rejects(save([change('vendor-html', '전체', { top: '', bottom: '' })]), { code: '23514' })
  await assert.rejects(save([
    change('vendor-html', '무신사', { top: '충돌 전 변경', bottom: '' }, vendor.revision),
    change('color-html', black, '오래된 편집본'),
  ]), { code: '40001' })
  assert.deepEqual(await list(), [body, photo, vendor], 'A later conflict rolls back the entire request')
  assert.equal((await readShared()).specs.colorPhotoUrls[ivory], photo.payload)

  const existing = (await db.query('select updated_at,specs from public.product_drafts where id=$1', [draft])).rows[0]
  await db.query("select public.save_product_draft($1,null,$2,$3,$4,'[]')",
    [company, draft, { nameKo: '기획안 제목만 수정', expectedUpdatedAt: existing.updated_at, specs: existing.specs }, colors])
  assert.deepEqual(await list(), [body, photo, vendor], 'Full draft edit preserves visual content for the same color IDs')

  const season = crypto.randomUUID()
  const schedule = { seasonId: season, targetDate: '2026-12-10', certainty: 'confirmed' }
  await db.query('update public.product_drafts set season_id=$2, specs=$3 where id=$1',
    [draft, season, { releaseSchedule: schedule }])
  const unrelatedSpecs = { coating: { note: '이전 화면에서 수정' } }
  const updateSpecs = await db.query('update public.product_drafts set specs=$2 where id=$1 returning specs',
    [draft, unrelatedSpecs])
  assert.deepEqual(updateSpecs.rows[0].specs, { ...unrelatedSpecs, releaseSchedule: schedule })
  const moveSeason = await db.query('update public.product_drafts set season_id=$2 where id=$1 returning specs',
    [draft, crypto.randomUUID()])
  assert.deepEqual(moveSeason.rows[0].specs, unrelatedSpecs, 'Moving a draft clears only its previous release schedule')

  await role(other)
  assert.deepEqual(await list(), [body, photo, vendor])
  await assert.rejects(db.query('update public.draft_visual_content set payload=$1 where draft_id=$2',
    [JSON.stringify('직접 수정'), draft]), { code: '42501' })
  await role(outsider)
  assert.deepEqual(await list(), [])
  await assert.rejects(save([change('color-html', black, '타사')]), { code: '42501' })
  await role('', 'anon')
  await assert.rejects(list(), { code: '42501' })
  await assert.rejects(save([change('color-html', black, '익명')]), { code: '42501' })
  await role(operator)
  const [cleared] = await save([change('color-html', black, '', body.revision)])
  assert.equal(cleared.payload, '')
  await role(author)
  await db.query('delete from public.draft_colors where draft_id=$1 and id=$2', [draft, ivory])
  assert.equal((await list()).some(row => row.entry_key === ivory), false)
  await assert.rejects(save([change('color-html', ivory, '삭제된 컬러')]), { code: '22023' })

  const status = async () => (await db.query('select * from public.list_draft_visual_status($1)', [[draft]])).rows[0]
  const image = 'data:image/png;base64,YQ=='
  const imageTemporary = crypto.randomUUID()
  const imageWorkingCopy = "insert into public.draft_information_temporary(draft_id,editor_id,field,color_id,revision,edits) values($1,$2,'image',$3,$4,$5)"
  await db.query(imageWorkingCopy, [draft, author, black, imageTemporary, { image: { source: '', text: image } }])
  await assert.rejects(db.query(imageWorkingCopy, [draft, author, black, crypto.randomUUID(), { image: { source: '', text: 'https://example.com/image' } }]), { code: '23514' })
  assert.deepEqual((await status()).temporary_images, [black])
  assert.deepEqual((await status()).saved_html, [], 'A cleared HTML entry does not count as saved')
  const [group] = await save([change('assignees', 'team', [visualOne, visualTwo])])
  assert.deepEqual((await status()).assignee_ids, [visualOne, visualTwo])
  await assert.rejects(save([change('assignees', 'team', [visualOne])]), { code: '40001' })
  for (const invalid of [[author], [visualOne, visualOne], [outsider]]) {
    await assert.rejects(save([change('assignees', 'team', invalid, group.revision)]), { code: '22023' })
  }
  await role(operator)
  assert.deepEqual((await status()).temporary_images, [], 'Another editor cannot see an image working copy')
  await db.query(imageWorkingCopy, [draft, operator, black, crypto.randomUUID(), { image: { source: '', text: image } }])
  await role(author)
  const sharedBeforeFinal = await readShared()
  const [blackFinal] = await save([{ ...change('color-photo', black, image), draft_revision: sharedBeforeFinal.revision }], imageTemporary)
  assert.equal((await readShared()).specs.colorPhotoUrls[black], image)
  assert.equal((await readShared()).specs.colorImageChoices[black], 'Image')
  assert.deepEqual((await status()).temporary_images, [])
  assert.deepEqual((await status()).saved_images, [black])
  await role(operator)
  assert.deepEqual((await status()).temporary_images, [black], 'Final save cleared only the author’s working copy')
  await role(other)
  assert.deepEqual((await status()).assignee_ids, [visualOne, visualTwo])
  await assert.rejects(save([change('assignees', 'team', [], group.revision)]), { code: '42501' })
  await assert.rejects(saveColors((await readShared()).revision, image), { code: '42501' })
  await assert.rejects(db.query('select app.expire_draft_visual_photos($1,$2)', [draft, [black]]), { code: '42501' })
  await role(author)
  const finalRevision = (await readShared()).revision
  await saveColors(finalRevision, image)
  assert.deepEqual((await status()).saved_images, [], 'Reuploading identical bytes through COLOR is provisional')
  assert.equal((await list()).some(row => row.kind === 'color-photo'), false)
  assert.equal((await readShared()).specs.colorPhotoUrls[black], image)
  await assert.rejects(save([{ ...change('color-photo', black, image, blackFinal.revision), draft_revision: finalRevision }]), { code: '40001' })
  const replacement = 'data:image/png;base64,Yg=='
  const beforeReplacement = (await readShared()).revision
  await saveColors(beforeReplacement, replacement)
  await assert.rejects(save([{ ...change('color-photo', black, image), draft_revision: beforeReplacement }]), { code: '40001' })
  assert.equal((await readShared()).specs.colorPhotoUrls[black], replacement)
  await save([{ ...change('color-photo', black, replacement), draft_revision: (await readShared()).revision }])
  assert.deepEqual((await status()).saved_images, [black])
  await saveColors((await readShared()).revision, null)
  assert.deepEqual((await status()).saved_images, [])
  assert.equal((await readShared()).specs.colorPhotoUrls[black], undefined)
  assert.equal((await readShared()).specs.colorImageChoices[black], 'None')
  await db.exec('reset role')
  const retired = (await db.query("select photo_current,payload from public.draft_visual_content where draft_id=$1 and entry_key=$2 and kind='color-photo'", [draft, black])).rows[0]
  assert.deepEqual(retired, { photo_current: false, payload: replacement }, 'The replaced final file remains in storage')
  await role(outsider)
  assert.equal(await status(), undefined)
  console.log('Draft Visual DB: access, private drafts, shared COLOR images, saved status, team assignments and conflicts passed')

  await db.exec('reset role')
  await db.exec(await readFile('supabase/migrations/20261124131129_draft_visual_information_notices.sql', 'utf8'))
  const notices = async () => (await db.query('select * from public.draft_information_notices order by created_at,id')).rows
  const readNotice = async id => (await db.query('select public.read_draft_information_notice($1)::text read_at', [id])).rows[0].read_at
  const saveSpecs = specs => db.query('update public.product_drafts set specs=$2 where id=$1', [draft, specs])
  await role(author)
  const [emptyGroup] = await save([change('assignees', 'team', [], group.revision)])
  const originalSpecs = { ...((await readShared()).specs), colorSpecs: { [black]: {
    size: 'W=300;D=120;H=210;STRAP=;UNIT=mm', weight: '250g', fabric: '면', sizeConfirmed: false, fabricConfirmed: false,
  } } }
  await saveSpecs(originalSpecs)
  const [activeGroup] = await save([change('assignees', 'team', [visualOne, visualTwo], emptyGroup.revision)])
  await role(visualOne)
  assert.deepEqual(await notices(), [], 'Assignment does not send earlier changes')
  await role(author)
  const confirmed = { ...originalSpecs, colorSpecs: { [black]: {
    ...originalSpecs.colorSpecs[black], sizeConfirmed: true, fabricConfirmed: true,
  } }, specDocumentConfirmed: true }
  await saveSpecs(confirmed)
  await saveSpecs({ ...confirmed, colorNames: { [black]: { nameEn: 'Black' } } })
  await saveSpecs(confirmed)
  await role(visualOne)
  const first = await notices()
  assert.equal(first.length, 3)
  assert.deepEqual(first.map(row => row.field).sort(), ['fabric', 'size', 'specDoc'])
  assert.ok(first.every(row => row.recipient_id === visualOne && row.changes[0].status === 'confirmed'))
  assert.equal(first.find(row => row.field === 'size').saved_values[0].weight, '250g')
  await assert.rejects(db.query('update public.draft_information_notices set read_at=now()'), { code: '42501' })
  await role(visualTwo)
  assert.equal(await readNotice(first[0].id), null, 'A different recipient cannot mark a notice read')
  assert.equal((await notices()).length, 3)
  await role(outsider)
  assert.deepEqual(await notices(), [])
  assert.equal(await readNotice(first[0].id), null)
  await role('', 'anon')
  await assert.rejects(notices(), { code: '42501' })
  await assert.rejects(readNotice(first[0].id), { code: '42501' })
  await role(author)
  assert.deepEqual(await notices(), [])
  await save([change('assignees', 'team', [visualOne], activeGroup.revision)])
  const updated = { ...confirmed, specDocumentConfirmed: false, colorSpecs: { [black]: {
    ...confirmed.colorSpecs[black], weight: '280g', fabricConfirmed: false,
  } } }
  await saveSpecs(updated)
  await role(visualTwo)
  assert.equal((await notices()).length, 3, 'Former assignees receive only changes made while assigned')
  await role(visualOne)
  const last = (await notices()).filter(row => !first.some(old => old.id === row.id))
  assert.equal(last.length, 3)
  assert.deepEqual(last.find(row => row.field === 'size').changes, [{ color: '블랙', fields: ['weight'], status: 'changed' }])
  assert.equal(last.find(row => row.field === 'fabric').changes[0].status, 'reopened')
  assert.equal(last.find(row => row.field === 'specDoc').changes[0].status, 'reopened')
  const firstRead = await readNotice(first[0].id)
  assert.ok(firstRead)
  assert.equal(await readNotice(first[0].id), firstRead)
  assert.equal((await notices()).filter(row => row.read_at !== null).length, 1, 'Reading one event leaves newer versions unread')
  console.log('Draft INFORMATION notices: assignment timing, confirmed/changed/reopened, duplicate saves, recipient access and exact read passed')
} finally {
  await db.close()
}
