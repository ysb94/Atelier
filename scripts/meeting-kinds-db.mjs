import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export async function verifyMeetingKinds(db,{company,host,member,outsider,alien,actor}) {
  const scalar=async(sql,args)=>Object.values((await db.query(sql,args)).rows[0])[0]
  const denied=async(sql,args,code)=>assert.rejects(()=>db.query(sql,args),error=>error.code===code)
  await db.exec('reset role')
  // 이전 검증 러너와도 단독으로 이어 실행할 수 있도록 필요한 회의 전용 추가분만 준비한다.
  if (!await scalar("select to_regclass('public.company_work_hours')")) await db.exec(await readFile('supabase/migrations/20261026084832_company_work_hours.sql','utf8'))
  if (!(await scalar("select pg_get_functiondef('app.meeting_write(jsonb,bigint,uuid)'::regprocedure)")).includes('v_lunch_start')) await db.exec(await readFile('supabase/migrations/20261026114655_meeting_host_lunch_rules.sql','utf8'))
  if (!(await scalar("select pg_get_functiondef('app.meeting_list()'::regprocedure)")).includes('detail_member')) await db.exec(await readFile('scripts/fixtures/meeting-kind-list-baseline.sql','utf8'))
  const profiles=await scalar('select md5(jsonb_agg(to_jsonb(p) order by id)::text) from public.profiles p')
  const existing=await scalar('select jsonb_agg(to_jsonb(s) order by id) from public.meeting_series s')
  await db.exec(await readFile('supabase/migrations/20261027074713_meeting_change_notices.sql','utf8'))
  await db.exec(await readFile('supabase/migrations/20261027105829_meeting_kinds.sql','utf8'))
  assert.deepEqual(await scalar("select jsonb_agg(to_jsonb(s)-'kind' order by id) from public.meeting_series s"),existing,'기존 회의·revision·일정 보존')
  assert.equal(await scalar("select count(*) from public.meeting_series where kind<>'project'"),0)
  for(const [index,kind] of ['meeting','one_off','project','routine','interview'].entries()) {
    await actor(host)
    const id=`31000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`
    const roundId=`41000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`
    const payload={id,kind,title:`성격 검증 ${kind}`,host:{id:host},members:[{id:member}],status:'in_progress',durationMinutes:60,
      rounds:[{id:roundId,round:1,startsAt:'',roomId:'',content:'',result:'',prepMaterials:[]}]}
    await scalar('select public.save_company_meeting($1,0)',[payload])
    const load=async()=> (await scalar('select public.list_company_meetings()')).find(row=>row.id===id)
    let saved=await load(); assert.equal(saved.kind,kind)
    await actor(outsider)
    assert.equal((await scalar('select public.list_company_meetings()')).some(row=>row.id===id),false,'준비 회의 비공개')
    await actor(host)
    saved.rounds[0].startsAt=`2031-01-${String(index+6).padStart(2,'0')}T10:00`;saved.rounds[0].roomId='room-1'
    await scalar('select public.confirm_company_meeting($1,$2,$3)',[saved,saved.revision,roundId]);saved=await load()
    assert.equal(saved.kind,kind,'확정 후 성격 보존')
    const booking=(await scalar("select public.list_meeting_calendar('2031-01-06','2031-01-10')")).find(row=>row.id===roundId)
    assert.equal(booking.kind,kind,'달력 성격 반환')
    await denied('select public.save_company_meeting($1,$2)',[{...saved,kind:kind==='routine'?'project':'routine'},saved.revision],'23514')
    await denied('select public.save_company_meeting($1,$2)',[{...saved,kind:'invalid'},saved.revision],'23514')
    // 구 버전 요청의 kind 누락은 기존 루틴·면접 등을 project로 바꾸지 않는다.
    const legacy={...saved};delete legacy.kind
    await scalar('select public.save_company_meeting($1,$2)',[legacy,saved.revision]);saved=await load();assert.equal(saved.kind,kind)
    await actor(member)
    await denied('select public.save_company_meeting($1,$2)',[{...saved,title:'멤버 수정'},saved.revision],'42501')
    const invitations=(await scalar('select public.list_my_meeting_invitations()')).filter(row=>row.href.includes(roundId))
    if(kind==='meeting') {
      assert.equal(invitations.length,0,'미팅에는 참석 요청 없음')
      assert.deepEqual(saved.rounds[0].responses,[])
      await denied('select public.respond_to_meeting($1,$2,$3)',[roundId,saved.rounds[0].scheduleVersion,'available'],'42501')
    } else {
      assert.equal(invitations.length,1,'면접 등 참석 요청 유지')
      await scalar('select public.respond_to_meeting($1,$2,$3)',[roundId,saved.rounds[0].scheduleVersion,'available'])
    }
    await actor(host);saved=await load()
    if(['meeting','one_off','interview'].includes(kind)) {
      await denied('select public.save_company_meeting($1,$2)',[{...saved,rounds:[...saved.rounds,{...payload.rounds[0],id:crypto.randomUUID(),round:2}]},saved.revision],'23514')
    } else {
      await scalar('select public.save_company_meeting($1,$2)',[{...saved,rounds:[...saved.rounds,{...payload.rounds[0],id:crypto.randomUUID(),round:2}]},saved.revision])
      saved=await load();assert.equal(saved.rounds.length,2,'프로젝트·루틴 다음 회차 유지')
    }
    if(kind==='meeting') {
      await denied('select public.save_company_meeting($1,$2)',[{...saved,rounds:saved.rounds.map(row=>({...row,content:'무단 회의록'}))},saved.revision],'23514')
      await denied('select public.begin_meeting_file($1,$2,$3,$4)',[roundId,'notes.txt','text/plain',4],'23514')
    }
    if(kind==='interview') {
      saved.rounds[0].startsAt='2031-01-10T14:00'
      await scalar('select public.confirm_company_meeting($1,$2,$3)',[saved,saved.revision,roundId])
      await actor(member)
      const updated=(await scalar('select public.list_company_meetings()')).find(row=>row.id===id)
      assert.equal(updated.rounds[0].responses[0].status,'pending','면접 일정 변경 시 응답 초기화')
    }
    await actor(alien);assert.equal((await scalar('select public.list_company_meetings()')).some(row=>row.id===id),false)
  }
  await actor(host)
  for(const kind of ['meeting','one_off','interview']) {
    const payload={id:crypto.randomUUID(),kind,title:'호스트만 있는 일정',host:{id:host},members:[],status:'in_progress',durationMinutes:30,
      rounds:[{id:crypto.randomUUID(),round:1,roomId:'',startsAt:'',content:'',result:''}]}
    await scalar('select public.save_company_meeting($1,0)',[payload])
  }
  await db.exec('reset role')
  assert.equal(await scalar('select md5(jsonb_agg(to_jsonb(p) order by id)::text) from public.profiles p'),profiles,'기존 사용자 승인·직책 변경 없음')
  console.log('meeting-kinds-db: 5가지 성격 저장/확정/구버전 호환·미팅 수락 생략·면접 응답/초기화·회차/자료 제한·호스트/타사 보호 통과')
}
