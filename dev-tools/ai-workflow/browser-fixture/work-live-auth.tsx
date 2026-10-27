import {createContext,useContext,useState,type ReactNode} from 'react'
import type {Profile} from '@/lib/supabase/profiles'
const company='e0000000-0000-4000-8000-000000000001'
const profiles:Record<string,Profile>={}
const defs=[['planner','10000000-0000-4000-8000-000000000001','기획 직원','ced99f89-ea80-4eeb-8f03-272bf72f5db1','기획팀'],['planner2','10000000-0000-4000-8000-000000000002','기획 직원','ced99f89-ea80-4eeb-8f03-272bf72f5db1','기획팀'],['manager','10000000-0000-4000-8000-000000000007','업무 담당자','7ac8b7a8-7f12-4f3e-a371-d2dac7e492f1','Visual Team'],['design','10000000-0000-4000-8000-000000000005','작업 직원','7ac8b7a8-7f12-4f3e-a371-d2dac7e492f1','Visual Team'],['ceo','56074867-fdc2-4ce5-8e97-cea431decc36','대표이사',null,'운영진']]
for(const [role,id,displayName,departmentId,departmentName] of defs)profiles[role!]={id,displayName,departmentId,departmentName,companyId:company,status:'active',isAdmin:false,email:'fixture@example.invalid',position:'',jobGrade:'',capabilities:[],memberships:[],permissionMode:'legacy',permissionGrants:role==='manager'?[{permission:'work.manage',scopeKind:'department',scopeId:departmentId!,scopeName:'Visual Team'}]:[],updatedAt:'2026-01-01'} as unknown as Profile
let role=new URLSearchParams(location.search).get('actor')||'planner'
export const liveFixture={get profile(){return profiles[role]},switch:(_role:string)=>{}}
const Auth=createContext(profiles[role])
export function AuthProvider({children}:{children:ReactNode}){
 const [profile,setProfile]=useState(profiles[role]);liveFixture.switch=next=>{role=next;setProfile(profiles[next])}
 return <Auth.Provider value={profile}><label>직원 계정 전환<select aria-label="직원 계정 전환" value={role} onChange={e=>liveFixture.switch(e.target.value)}>{defs.map(([key,,name])=><option key={key} value={key!}>{key} · {name}</option>)}</select></label>{children}</Auth.Provider>
}
export function useAuth(){const profile=useContext(Auth);return {profile,session:{user:{id:profile.id}},ready:true,email:profile.email,refreshProfile:async()=>profile,signOut:async()=>{}}}
export const AuthDisplayProvider=AuthProvider
