import { getSupabase as baseClient } from './page-preview-client'
import { fixtureProfile, releaseFixture } from './release-auth'
import { hasPermission } from '@/lib/company/permissions'
import type { PersonalWorkCard, PersonalWorkEvent } from '@/lib/supabase/personal-work'
import type { PersonalWorkFeedbackNotice } from '@/features/settings/use-personal-work-feedback-notices'

const coworker = {id:'fixture-coworker',name:'부서원',position:'사원'}
const personalWork = new Map<string, PersonalWorkCard>()
const feedbackNotices = new Map<string, PersonalWorkFeedbackNotice & { recipient_id: string }>()
let workMinute = 0

function workFixture(name:string,args:Record<string,unknown>) {
 const actor=fixtureProfile()
 if(name==='list_personal_work_members')return {data:[coworker],error:null}
 if(name==='list_personal_work_cards')return {data:[...personalWork.values()].filter(card=>
  card.assignee_id===actor.id || card.created_by===actor.id || (card.reviewer_id===actor.id && card.status==='feedback')),error:null}
 const id=String(args.p_id), current=personalWork.get(id)
 if(name==='read_personal_work_feedback_notice') {
  const notice=feedbackNotices.get(id)
  if(!notice || notice.recipient_id!==actor.id || notice.card_revision!==args.p_revision)return {data:null,error:null}
  releaseFixture.workCommands.push(name)
  notice.read_at ??= new Date().toISOString()
  return {data:notice.read_at,error:null}
 }
 const action=name==='submit_personal_work_feedback'?'submit':String(args.p_action)
 releaseFixture.workCommands.push(name==='personal_work_action'?action:name)
 const at=new Date(Date.UTC(2026,10,23,0,workMinute++)).toISOString()
 if(action==='create') {
  const assigned=args.p_assignee===coworker.id
  personalWork.set(id,{id,title:String(args.p_title),description:String(args.p_description??''),status:'todo',round:1,revision:1,
   created_at:at,created_by:actor.id,creator_name:actor.displayName,assignee_id:assigned?coworker.id:actor.id,
   assignee_name:assigned?coworker.name:actor.displayName,reviewer_id:assigned?actor.id:null,reviewer_name:assigned?actor.displayName:null,events:[]})
 } else if(!current) return {data:null,error:{message:'테스트 카드를 찾을 수 없습니다.'}}
 else if(action==='edit') {
  current.title=String(args.p_title);current.description=String(args.p_description??'');current.revision++
 } else if(action==='delete') personalWork.delete(id)
 else {
  const states={start:'doing',pause:'todo',complete:'done',submit:'feedback',approve:'done'} as const
  const events={start:current.events.length?'resumed':'started',pause:'paused',complete:'completed',submit:'submitted',approve:'approved'} as const
  const transition=action as keyof typeof states
  if(!states[transition])return {data:null,error:{message:'테스트 업무 상태 변경 실패'}}
  const note=typeof args.p_note==='string'?args.p_note:null
  const event:PersonalWorkEvent={kind:events[transition],round:current.round,at,actor_id:actor.id,note}
  current.status=states[transition];current.events.push(event);current.revision++
  if(transition==='submit'&&current.reviewer_id){
   const eventId=String(args.p_command)
   feedbackNotices.set(eventId,{id:eventId,card_id:id,card_revision:current.revision,round:current.round,title:current.title,
    note,requester_name:actor.displayName,created_at:at,read_at:null,resolved_at:null,recipient_id:current.reviewer_id})
  }
  if(transition==='approve')for(const notice of feedbackNotices.values())if(notice.card_id===id)notice.resolved_at=at
 }
 return {data:null,error:null}
}
export const isSupabaseConfigured=()=>true
export function getSupabase(){
 const base=baseClient()
 return {...base,auth:{getUser:async()=>({data:{user:{id:fixtureProfile().id}},error:null}),getSession:async()=>({data:{session:{user:{id:fixtureProfile().id}}},error:null})},
 functions:{invoke:async(_name:string)=>({data:{ok:true,targets:[]},error:null})},
 from(table:string){
  releaseFixture.reads.push(table)
  if(table==='personal_work_feedback_notices'){
    let id: string | undefined, single=false
    const query={select(){return query},eq(field:string,value:string){if(field==='id')id=value;return query},order(){return query},
      limit(){return query},abortSignal(){return query},maybeSingle(){single=true;return query},then(resolve:(value:unknown)=>unknown){
        const rows=[...feedbackNotices.values()].filter(notice=>notice.recipient_id===fixtureProfile().id&&(!id||notice.id===id)).map(notice=>({...notice}))
        return Promise.resolve({data:single?rows[0]??null:rows,error:null}).then(resolve)
      }}
    return query
  }
  // 메뉴·신청 화면 검증은 이미 출근한 직원의 모의 기록을 사용한다.
  if(table==='attendance_clock_ins'){
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
    const query={select(){return query},eq(){return query},order(){return query},gte(){return query},lte(){return query},limit(){return query},then(resolve:(result:unknown)=>unknown){return Promise.resolve({data:[{work_date:day,clock_in:'09:00:00',clock_out_at:null}],error:null}).then(resolve)}}
    return query
  }
  if(table==='profiles'){
    const profile=fixtureProfile()
    let single=false
    const value={id:profile.id,email:profile.email,display_name:profile.displayName,company_id:profile.companyId,status:profile.status,is_admin:profile.isAdmin,department_id:profile.departmentId,position:profile.position,job_grade:profile.jobGrade,name_confirmed_at:'2026-01-01',requested_at:'2026-01-01'}
    const query={select(){return query},eq(){return query},in(){return query},order(){return query},maybeSingle(){single=true;return query},then(resolve:(result:unknown)=>unknown){return Promise.resolve({data:single?value:[value],error:null}).then(resolve)}}
    return query
  }
  if(table!=='department_request_approvers')return base.from(table)
  let offset=0
  const chain={select(){return chain},order(){return chain},range(start:number){offset=start;return chain},then(resolve:(value:unknown)=>unknown){
    const role=releaseFixture.role
    const approved=role==='approver'||role==='substitute'||role==='logistics-approver'
    const data=approved&&offset===0?[{department_id:'other-department',request_type:'leave',approver_id:role==='substitute'?'other-user':'fixture-user',substitute_id:role==='substitute'?'fixture-user':null,updated_at:'2026-01-01'}]:[]
    return Promise.resolve(releaseFixture.approvalError?{data:null,error:{message:'검증용 승인자 조회 실패'}}:{data,error:null}).then(resolve)
  }}
  return chain
 },rpc(name:string,args?:Record<string,unknown>){
  if(['list_personal_work_cards','list_personal_work_members','personal_work_action','submit_personal_work_feedback','read_personal_work_feedback_notice'].includes(name))return Promise.resolve(workFixture(name,args??{}))
  if(name==='list_work_requests')return Promise.resolve({data:{requests:[],files:[],timers:[],managerAvailable:true},error:null})
  if(name==='is_my_attendance_exempt')return Promise.resolve({data:hasPermission(fixtureProfile(),'attendance.exempt'),error:null})
  if(name==='clock_in_today'){releaseFixture.writes.push(name);return Promise.resolve({data:'09:00:00',error:null})}
  return base.rpc(name,args)
 }}
}
