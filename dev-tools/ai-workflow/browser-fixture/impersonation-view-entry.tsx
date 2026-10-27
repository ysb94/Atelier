import { StrictMode, useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, useLocation } from 'react-router-dom'
import { releaseAccess, releaseHref } from '@/lib/company/release-access'
import { ReleasePageGate } from '@/components/layout/ReleasePageGate'
import { ImpersonationViewRestore } from '@/components/layout/ImpersonationViewRestore'
import { startImpersonation, returnToOperator } from '@/lib/supabase/impersonation'
const actors={developer:'d0000000-0000-4000-8000-000000000001',delegate:'a5afdd00-4a61-44dc-a1a3-082fa8a1345d',ceo:'56074867-fdc2-4ce5-8e97-cea431decc36',planner:'10000000-0000-4000-8000-000000000001',planner2:'10000000-0000-4000-8000-000000000002',design:'10000000-0000-4000-8000-000000000003'}
const initial=new URLSearchParams(location.search).get('operator') as keyof typeof actors|null
let actorId=sessionStorage.getItem('fixture:actor')||actors[initial||'developer'],targetId=''
function session(){return {user:{id:actorId},access_token:'fixture:'+actorId,refresh_token:'refresh:'+actorId}}
export function getSupabase(){return {
 auth:{getSession:async()=>({data:{session:session()}}),setSession:async(input:{access_token:string})=>{actorId=input.access_token.slice('fixture:'.length);sessionStorage.setItem('fixture:actor',actorId);return {data:{session:session()},error:null}},verifyOtp:async()=>{actorId=targetId;sessionStorage.setItem('fixture:actor',actorId);return {data:{session:session()},error:null}},signOut:async()=>({error:null})},
 functions:{invoke:async(_name:string,{body}:{body:{action:string;targetId:string}})=>{if(sessionStorage.getItem('fixture:fail')){sessionStorage.removeItem('fixture:fail');return {data:null,error:{context:{status:403,json:async()=>({error:'검증용 전환 실패'})}}}}targetId=body.targetId;return {data:body.action==='start'?{tokenHash:'fixture',eventId:'fixture-event',target:{id:targetId,name:'검증 직원',department:'기획팀',position:'사원'}}:{revoked:true},error:null}}}
}}
export function useAuth(){return {profile:{id:actorId,status:'active' as const,companyId:'e0000000-0000-4000-8000-000000000001',departmentId:actorId===actors.design?'7ac8b7a8-7f12-4f3e-a371-d2dac7e492f1':'ced99f89-ea80-4eeb-8f03-272bf72f5db1'},session:session()}}
let finishAttendance=()=>{}
export function useAttendanceEntry(){const [ready,setReady]=useState(sessionStorage.getItem('fixture:attendance')==='ready'||!new URLSearchParams(location.search).has('gate'));finishAttendance=()=>{sessionStorage.setItem('fixture:attendance','ready');setReady(true)};return {phase:ready?'ready':'clock-in',checkoutOpen:false}}
export function ReleaseAccessProvider({children}:{children:ReactNode}){return children}
export function useReleaseAccess(){const {profile}=useAuth();return {scope:releaseAccess(profile),href:(href:string)=>releaseHref(profile,href),approvals:{loading:false,error:null,refresh:async()=>{}}}}
function Content(){
 const [loaded,setLoaded]=useState(false)
 useEffect(()=>{const timer=setTimeout(()=>setLoaded(true),new URLSearchParams(location.search).has('delay')?800:0);return()=>clearTimeout(timer)},[])
 return <div id="surface" style={{width:1100,height:loaded?3600:380}}><p data-testid="loaded">{String(loaded)}</p><input aria-label="미저장 입력" defaultValue=""/><div id="sheet-scroll" className="draft-board-scroll" style={{width:720,height:140,overflow:'auto'}}><div style={{width:loaded?2400:720,height:loaded?600:140}}>공유 기획안 내용</div></div></div>
}
function Fixture(){
 const [error,setError]=useState(''),location=useLocation()
 return <><header><output data-testid="actor">{actorId}</output>{(['planner','planner2','design'] as const).map(actor=><button key={actor} onClick={()=>void startImpersonation(actors[actor],'검증 운영자').catch(error=>setError(error.message))}>{actor}</button>)}<button onClick={()=>void returnToOperator()}>복귀</button><button onClick={()=>finishAttendance()}>출근 확인 완료</button><p role="alert">{error}</p><span data-testid="route">{location.pathname+location.search+location.hash}</span></header><div data-brand-page-scroll style={{width:900,height:320,overflow:'auto'}}><ReleasePageGate><ImpersonationViewRestore/><Content/></ReleasePageGate></div></>
}
createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><Fixture/></BrowserRouter></StrictMode>)
