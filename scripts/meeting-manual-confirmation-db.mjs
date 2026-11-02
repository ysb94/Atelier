import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export async function verifyMeetingManualConfirmation(db,{host,member,outsider,alien,actor}) {
 const value=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0]
 const denied=async(sql,args,code)=>assert.rejects(()=>db.query(sql,args),error=>error.code===code)
 await db.exec('reset role')
 await db.exec(await readFile('supabase/migrations/20261102074305_meeting_manual_confirmation.sql','utf8'))
 assert.equal(await value("select has_function_privilege('anon','public.manually_confirm_meeting_round(uuid,bigint,integer,uuid[])','execute')"),false,'익명 실행 금지')
 assert.equal(await value("select prosecdef from pg_proc where oid='public.manually_confirm_meeting_round(uuid,bigint,integer,uuid[])'::regprocedure"),false,'공개 RPC는 invoker')
 const id='35000000-0000-4000-8000-000000000001',rid='45000000-0000-4000-8000-000000000001'
 const load=async()=> (await value('select public.list_company_meetings()')).find(s=>s.id===id)
 await actor(host)
 let series={id,kind:'project',title:'차수별 불참 제외 검증',host:{id:host},members:[{id:member},{id:outsider}],status:'in_progress',durationMinutes:60,
  rounds:[{id:rid,round:1,startsAt:'2030-02-04T10:00',roomId:'room-1',content:'회의 안내',result:'',prepMaterials:[]}]}
 await value('select public.confirm_company_meeting($1,0,$2)',[series,rid]);series=await load()
 const confirm=()=>value('select public.manually_confirm_meeting_round($1,$2,1,$3)',[rid,series.revision,[outsider]])
 await denied('select public.manually_confirm_meeting_round($1,$2,1,$3)',[rid,series.revision,[outsider]],'23514')
 await actor(member);await value("select public.respond_to_meeting($1,1,'available')",[rid])
 await actor(outsider);await value("select public.respond_to_meeting($1,1,'unavailable')",[rid])
 await denied('select public.manually_confirm_meeting_round($1,$2,1,$3)',[rid,series.revision,[outsider]],'42501')
 await actor(alien);await denied('select public.manually_confirm_meeting_round($1,$2,1,$3)',[rid,series.revision,[outsider]],'42501')
 await actor(host)
 await denied('select public.manually_confirm_meeting_round($1,$2,1,$3)',[rid,series.revision,[]],'40001')
 const revision=await confirm();assert.equal(await confirm(),revision,'중복 확정은 한 번만 기록')
 series=await load()
 assert.deepEqual(series.rounds[0].manualConfirmation.excludedIds,[outsider])
 assert.equal(series.members.length,2,'전체 프로젝트 멤버 유지')
 assert.equal(series.rounds[0].responses.find(r=>r.profileId===outsider).status,'unavailable','원래 불참 응답 보존')
 await denied('select * from app.meeting_round_decisions',[],'42501')
 const availability=await value("select public.list_meeting_availability($1,'2030-02-04',$2,null)",[id,[member,outsider]])
 assert.ok(availability.some(a=>a.kind==='meeting'&&a.personId===member),'참석자 일정 유지')
 assert.ok(!availability.some(a=>a.kind==='meeting'&&a.personId===outsider),'제외자 시간 점유 해제')
 const calendar=await value("select public.list_meeting_calendar('2030-02-04','2030-02-04')")
 assert.equal(calendar.find(b=>b.id===rid).roomId,'room-1','회의실 예약은 유지')
 assert.ok(!calendar.find(b=>b.id===rid).members.some(m=>m.id===outsider),'서버 달력에서도 차수별 제외 반영')
 await actor(outsider)
 await denied("select public.respond_to_meeting($1,1,'available')",[rid],'42501')
 assert.ok((await value('select public.list_my_meeting_invitations()')).some(n=>n.title==='이번 차수 참석 제외'),'제외 결과 안내')
 await actor(member)
 assert.ok((await value('select public.list_my_meeting_invitations()')).some(n=>n.title==='회의 진행 확정'),'진행 확정 안내')
 await actor(host)
 series=await load()
 const next='45000000-0000-4000-8000-000000000002'
 series.rounds.push({id:next,round:2,startsAt:'2030-02-05T10:00',roomId:'room-1',content:'2차',result:'',prepMaterials:[]})
 await value('select public.confirm_company_meeting($1,$2,$3)',[series,series.revision,next])
 series=await load()
 assert.equal(series.rounds[1].manualConfirmation,null,'다음 차수에는 제외가 이어지지 않음')
 assert.equal(series.rounds[1].responses.length,2,'다음 차수에는 전원 초대')
 assert.deepEqual(series.rounds[0].manualConfirmation.excludedIds,[outsider],'다음 차수 저장으로 기존 확정이 지워지지 않음')
 series.rounds[0].startsAt='2030-02-04T11:00'
 await value('select public.confirm_company_meeting($1,$2,$3)',[series,series.revision,rid])
 series=await load()
 assert.equal(series.rounds[0].manualConfirmation,null,'일정 변경 시 수동 확정 초기화')
 assert.ok(series.rounds[0].responses.every(r=>r.status==='pending'),'일정 변경 후 전원 재응답')
 await db.exec('reset role')
 assert.equal(Number(await value('select count(*) from app.meeting_round_decision_history where round_id=$1',[rid])),1,'중복 요청에도 확정 이력 한 건 보존')
 console.log('meeting-manual-confirmation-db: 호스트 권한·전원 응답·명단 경합·중복·불참 이력·차수 격리·알림·시간 점유·일정 변경 통과')
}
