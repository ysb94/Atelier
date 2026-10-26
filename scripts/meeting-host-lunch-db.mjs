import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export async function verifyMeetingHostLunch(db,{company,host,member,admin,draftId,roundId,actor}) {
  const scalar=async(sql,params)=>Object.values((await db.query(sql,params)).rows[0])[0]
  const load=async()=> (await scalar('select public.list_company_meetings()')).find(item=>item.id===draftId)
  const denied=async(sql,params,code='42501')=>assert.rejects(()=>db.query(sql,params),error=>error.code===code)
  await db.exec('reset role')
  const before=await scalar('select md5(jsonb_agg(to_jsonb(p) order by id)::text) from public.profiles p')
  await db.exec(await readFile('supabase/migrations/20261026084832_company_work_hours.sql','utf8'))
  await db.exec(await readFile('supabase/migrations/20261026114655_meeting_host_lunch_rules.sql','utf8'))
  await actor(host)
  let current=await load()
  const original=structuredClone(current)
  for(const who of [member,admin]) {
    await actor(who)
    for(const patch of [
      {...current,status:'done'},
      {...current,title:'다른 사람이 바꾼 주제'},
      {...current,host:{id:who}},
      {...current,rounds:current.rounds.map(round=>({...round,content:'무단 내용 수정',result:'무단 결과 수정'}))},
      {...current,rounds:[]},
    ]) await denied('select public.save_company_meeting($1,$2)',[patch,current.revision])
    await denied('select public.confirm_company_meeting($1,$2,$3)',[current,current.revision,roundId])
    await denied('select public.delete_company_meeting($1,$2)',[draftId,current.revision])
  }
  await actor(host)
  assert.deepEqual(await load(),original,'멤버·운영자의 수정/삭제 요청은 회의를 바꾸지 않음')
  current.rounds=current.rounds.map(round=>round.id===roundId?{...round,content:'호스트가 저장한 내용',result:'호스트 결과'}:round)
  await scalar('select public.save_company_meeting($1,$2)',[current,current.revision])
  current=await load()
  assert.equal(current.rounds.find(round=>round.id===roundId).content,'호스트가 저장한 내용','기존 점심 예약의 내용 수정은 허용')
  const move=clock=>({...current,rounds:current.rounds.map(round=>round.id===roundId?{...round,startsAt:'2030-01-08T'+clock,durationMinutes:60}:round)})
  for(const clock of ['11:30','12:00','12:30']) await denied('select public.confirm_company_meeting($1,$2,$3)',[move(clock),current.revision,roundId],'23514')
  await scalar('select public.confirm_company_meeting($1,$2,$3)',[move('11:00'),current.revision,roundId])
  current=await load()
  await scalar('select public.confirm_company_meeting($1,$2,$3)',[move('13:00'),current.revision,roundId])
  current=await load()
  await db.exec('reset role')
  await db.query("insert into public.company_work_hours(company_id,lunch_start,lunch_end) values($1,'12:30','13:30')",[company])
  await actor(host)
  for(const clock of ['12:00','13:00']) await denied('select public.confirm_company_meeting($1,$2,$3)',[move(clock),current.revision,roundId],'23514')
  await scalar('select public.confirm_company_meeting($1,$2,$3)',[move('11:30'),current.revision,roundId])
  current=await load()
  await scalar('select public.confirm_company_meeting($1,$2,$3)',[move('13:30'),current.revision,roundId])
  current=await load()
  await actor(member)
  const file=await scalar('select public.begin_meeting_file($1,$2,$3,$4)',[roundId,'멤버 자료.txt','text/plain',4])
  await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['company-meetings',file.path,{size:4}])
  await db.query('select public.finish_meeting_file($1)',[file.id])
  await db.query('select public.remove_meeting_file($1)',[file.id])
  await db.query('delete from storage.objects where name=$1',[file.path])
  await db.query('select public.finish_meeting_cleanup($1)',[[file.path]])
  await actor(host)
  current=await load()
  await db.query('select public.delete_company_meeting($1,$2)',[draftId,current.revision])
  assert.equal(await load(),undefined,'호스트는 직접 삭제할 수 있음')
  await db.exec('reset role')
  assert.equal(await scalar('select md5(jsonb_agg(to_jsonb(p) order by id)::text) from public.profiles p'),before,'사용자·로그인·승인·직책은 변경하지 않음')
  console.log('meeting-host-lunch-db: 멤버/운영자 수정·삭제·확정 거부, 호스트 허용, 점심 전체/일부 겹침 차단, 경계 허용, 회사 설정 변경, 기존 예약 유지, 자료 공유 유지 통과')
}
