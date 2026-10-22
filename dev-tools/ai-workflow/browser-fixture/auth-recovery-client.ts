// 실제 AuthProvider·프로필 로더 검증용. 외부 네트워크/운영 계정을 사용하지 않는다.
const params = new URLSearchParams(location.search)
const id='10000000-0000-4000-8000-000000000001', company='e0000000-0000-4000-8000-000000000001', dept='20000000-0000-4000-8000-000000000001'
let failure=params.has('profile-error')
const fresh=params.has('new-request')
const profile = { id,email:'dev@atelier.local',status:params.has('rejected')?'rejected':fresh||params.has('pending')?'pending':'active',is_admin:!fresh,display_name:fresh?null:'검증 개발자',company_id:company,department_id:fresh?null:dept,position:fresh?null:'사원',job_grade:fresh?null:'사원',name_confirmed_at:fresh?null:'2026-01-01',requested_at:fresh||params.has('no-request')?null:'2026-01-01',memberships:[],capabilities:[] }
const applicant={...profile,id:'10000000-0000-4000-8000-000000000002',email:'applicant@example.invalid',display_name:'가입 검증',status:'pending',department_id:null,position:null,job_grade:null,is_admin:false}
const audit={updates:0,rpcs:[] as string[],tables:[] as string[],patches:[] as Record<string,unknown>[]}
const user={id,email:profile.email}
const session={user}
export function isSupabaseConfigured(){return true}
export function getSupabase(){return client as never}
Object.assign(window,{__authRecovery:{audit,profile,applicant,recover:()=>{failure=false}}})
const client={auth:{getSession:async()=>({data:{session},error:null}),getUser:async()=>({data:{user},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})},
rpc:async(name:string)=>{audit.rpcs.push(name);return {data:null,error:{code:'PGRST202',message:'function not found'}}},
from(table:string){
 audit.tables.push(table)
 let patch:Record<string,unknown>|undefined
 const filters:((row:Record<string,unknown>)=>boolean)[]=[]
 function result(single=false){
  if(table==='profiles'&&failure)return {data:null,error:{message:'profile lookup failed'}}
  let rows:Record<string,unknown>[]=table==='profiles'?(params.has('members')?[profile,applicant]:[profile]):table==='departments'?[{id:dept,company_id:company,name:'운영지원팀',is_active:true,personnel_scope:'members'}]:table==='profile_capabilities'?[{profile_id:id,capability:'design'}]:[]
  rows=rows.filter(row=>filters.every(filter=>filter(row)))
  if(patch&&rows.length){
   if(params.has('save-error'))return {data:null,error:{message:'검증용 신청 저장 실패'}}
   audit.updates++;audit.patches.push({...patch});rows.forEach(row=>Object.assign(row,patch))
  }
  return {data:single?(rows[0]??null):rows,error:single&&patch&&!rows.length?{message:'no matching row'}:null}
 }
 // 실제 프로필 응답처럼 세션 알림과 별도 작업에서 도착시킨다.
 const singleResult=()=>new Promise(resolve=>setTimeout(()=>resolve(result(true)),10))
 const query={select(){return query},eq(key:string,value:unknown){filters.push(row=>row[key]===value);return query},in(key:string,values:unknown[]){filters.push(row=>values.includes(row[key]));return query},update(value:Record<string,unknown>){patch=value;return query},order(){return query},maybeSingle:singleResult,single:singleResult,then(resolve:(value:unknown)=>void){return Promise.resolve(result()).then(resolve)}}
 return query
}}
