import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Profile } from '@/lib/supabase/profiles'
import { hasPermission, PERMISSION_CATALOG } from '@/lib/company/permissions'
import { RELEASE_COMPANY_ID, RELEASE_DEPARTMENT_SITES, RELEASE_OPERATIONS_ID, RELEASE_LOGISTICS_ID, RELEASE_EXCEPTION_IDS } from '@/lib/company/release-access'
const departmentFixtures = {
  planning: {id:RELEASE_DEPARTMENT_SITES.find(site=>site.title==='기획')!.id,name:'기획팀'},
  md: {id:RELEASE_DEPARTMENT_SITES.find(site=>site.title==='MD')!.id,name:'MD Team'},
  china: {id:RELEASE_DEPARTMENT_SITES.find(site=>site.title==='중국팀')!.id,name:'중국팀'},
  contents: {id:'contents-department',name:'Contents Team'},
  global: {id:'global-department',name:'Global Online'},
  visual: {id:'visual-department',name:'Visual Team'},
  b2b: {id:'b2b-department',name:'B2B 사업팀'},
  offline: {id:'offline-department',name:'OFF LINE TEAM'},
  'china-global': {id:'china-global-department',name:'CHINA'},
  marketing: {id:'marketing-department',name:'마케팅팀'},
  executives: {id:'executives-department',name:'운영진'},
} as const
type Role = 'staff'|'approver'|'substitute'|'operations'|'logistics'|'logistics-approver'|'developer'|'owner'|'ceo'|keyof typeof departmentFixtures
let currentRole = (new URLSearchParams(location.search).get('role') || 'staff') as Role
export const releaseFixture = { get role(){ return currentRole }, approvalError:new URLSearchParams(location.search).has('approval-error'), reads:[] as string[], writes:[] as string[], setRole:(_role:Role)=>{}, refresh:()=>{} }
Object.assign(window,{__releaseFixture:releaseFixture})
export function fixtureProfile(role = currentRole) {
  const index = ['developer','owner','ceo'].indexOf(role)
  const department = role==='operations'?{id:RELEASE_OPERATIONS_ID,name:'운영지원팀'}
    : role.startsWith('logistics')?{id:RELEASE_LOGISTICS_ID,name:'물류팀'}
      : departmentFixtures[role as keyof typeof departmentFixtures]??{id:'other-department',name:'일반팀'}
  return {
    id:index>=0?RELEASE_EXCEPTION_IDS[index]:'fixture-user',email:index>=0?'owner@example.invalid':'staff@example.invalid',displayName:role,
    companyId:RELEASE_COMPANY_ID,status:'active',departmentId:department.id,
    departmentName:department.name,position:'사원',jobGrade:'사원',isAdmin:true,capabilities:[],memberships:[],
    nameConfirmedAt:'2026-01-01',permissionMode:'assigned',
    permissionGrants:(role==='staff'||role==='approver'||role==='substitute'?PERMISSION_CATALOG.filter(([key])=>key==='basic.use'):PERMISSION_CATALOG).map(([permission])=>({permission,scopeKind:'company',scopeId:RELEASE_COMPANY_ID})),
  } as unknown as Profile
}
const Auth = createContext(fixtureProfile())
export function AuthProvider({children}:{children:ReactNode}) {
  const [profile,setProfile]=useState(fixtureProfile)
  releaseFixture.setRole=role=>{currentRole=role;setProfile(fixtureProfile(role));releaseFixture.refresh()}
  return <Auth.Provider value={profile}>{children}</Auth.Provider>
}
export function useAuth(){ const profile=useContext(Auth);return {profile,session:{user:{id:profile.id,email:profile.email}},email:profile.email,ready:true,signOut:async()=>{},refreshProfile:async()=>profile} }
export function AuthDisplayProvider({profile,children}:{profile:Profile;children:ReactNode}){ const value=useMemo(()=>profile,[profile]);return <Auth.Provider value={value}>{children}</Auth.Provider> }
export function canAccessBrand(profile:Profile|null){return profile?.status==='active'}
export function isBrandLead(profile:Profile|null,brandId:string){return hasPermission(profile,'brand.edit','brand',brandId)}
