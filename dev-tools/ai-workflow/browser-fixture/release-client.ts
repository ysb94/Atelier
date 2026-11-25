import { getSupabase as baseClient } from './page-preview-client'
import { fixtureProfile, releaseFixture } from './release-auth'
import { RELEASE_VISUAL_ID } from '@/lib/company/release-access'
import { hasPermission } from '@/lib/company/permissions'
import type { PersonalWorkCard, PersonalWorkEvent } from '@/lib/supabase/personal-work'

const coworker = {id:'fixture-coworker',name:'부서원',position:'사원'}
const personalWork = new Map<string, PersonalWorkCard>()
let departure: { resignedOn: string; processedAt: string; handedOver: boolean } | undefined
const departureEmployee = 'fixture-departure-employee'
const departureSuccessor = 'fixture-departure-successor'
let workMinute = 0

function workFixture(name:string,args:Record<string,unknown>) {
 const actor=fixtureProfile()
 if(name==='list_personal_work_members')return {data:[coworker],error:null}
 if(name==='list_personal_work_cards')return {data:[...personalWork.values()].filter(card=>
  card.assignee_id===actor.id || card.created_by===actor.id || (card.reviewer_id===actor.id && card.status==='feedback')),error:null}
 const id=String(args.p_id), current=personalWork.get(id), action=String(args.p_action)
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
  const states={start:'doing',pause:'todo',complete:'done'} as const
  const events={start:current.events.length?'resumed':'started',pause:'paused',complete:'completed'} as const
  const transition=action as keyof typeof states
  if(!states[transition])return {data:null,error:{message:'테스트 업무 상태 변경 실패'}}
  const event:PersonalWorkEvent={kind:events[transition],round:current.round,at,actor_id:actor.id,note:null}
  current.status=states[transition];current.events.push(event);current.revision++
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
    const query={select(){return query},eq(){return query},in(){return query},order(){return query},maybeSingle(){single=true;return query},then(resolve:(result:unknown)=>unknown){
      const rows=releaseFixture.role==='operations'?[value,
        {...value,id:departureEmployee,display_name:'퇴사 검증 직원',email:'departing@example.invalid',status:departure?'disabled':'active'},
        {...value,id:departureSuccessor,display_name:'인계 검증 직원',department_id:RELEASE_VISUAL_ID,email:'successor@example.invalid'}]:[value]
      return Promise.resolve({data:single?value:rows,error:null}).then(resolve)
    }}
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
  if(['list_personal_work_cards','list_personal_work_members','personal_work_action'].includes(name))return Promise.resolve(workFixture(name,args??{}))
  if(name==='list_work_requests')return Promise.resolve({data:{requests:[],files:[],timers:[],managerAvailable:true},error:null})
  if(name==='list_employee_departures')return Promise.resolve({data:departure?[{employeeId:departureEmployee,resignedOn:departure.resignedOn}]:[],error:null})
  if(name==='preview_employee_departure'&&args?.p_employee===departureEmployee)return Promise.resolve({data:{
    version:departure?.handedOver?'handed-over':departure?'departed':'active',processedAt:departure?.processedAt??null,
    resignedOn:departure?.resignedOn??null,personalCount:departure?.handedOver?0:1,sentCount:0,
    requestGroups:departure?.handedOver?[]:[{owner:'design',departmentId:RELEASE_VISUAL_ID,count:1,settingsCount:0}],
    approvalCount:departure?.handedOver?0:1,canHandoverApprovals:true,
  },error:null})
  if(name==='confirm_employee_departure'&&args?.p_employee===departureEmployee){
    releaseFixture.workCommands.push(args.p_work_successor===null&&args.p_approval_successor===null
      && JSON.stringify(args.p_request_successors)==='{}'?'departure-deferred':'departure-immediate')
    departure={resignedOn:String(args.p_resigned_on),processedAt:new Date().toISOString(),handedOver:false}
    return Promise.resolve({data:departure,error:null})
  }
  if(name==='handover_departed_employee_work'&&args?.p_employee===departureEmployee&&departure){
    releaseFixture.workCommands.push(args.p_work_successor===departureSuccessor&&args.p_approval_successor===departureSuccessor
      && (args.p_request_successors as {design?:string})?.design===departureSuccessor?'departure-handover':'departure-handover-mismatch')
    departure.handedOver=true
    return Promise.resolve({data:departure,error:null})
  }
  if(name==='is_my_attendance_exempt')return Promise.resolve({data:hasPermission(fixtureProfile(),'attendance.exempt'),error:null})
  if(name==='clock_in_today'){releaseFixture.writes.push(name);return Promise.resolve({data:'09:00:00',error:null})}
  return base.rpc(name,args)
 }}
}
