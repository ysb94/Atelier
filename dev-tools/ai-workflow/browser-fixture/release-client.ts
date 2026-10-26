import { getSupabase as baseClient } from './page-preview-client'
import { fixtureProfile, releaseFixture } from './release-auth'
export const isSupabaseConfigured=()=>true
export function getSupabase(){
 const base=baseClient()
 return {...base,auth:{getUser:async()=>({data:{user:{id:fixtureProfile().id}},error:null}),getSession:async()=>({data:{session:{user:{id:fixtureProfile().id}}},error:null})},
 functions:{invoke:async(_name:string)=>({data:{ok:true,targets:[]},error:null})},
 from(table:string){
  releaseFixture.reads.push(table)
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
  if(name==='clock_in_today'){releaseFixture.writes.push(name);return Promise.resolve({data:'09:00:00',error:null})}
  return base.rpc(name,args)
 }}
}
