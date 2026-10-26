import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Profile } from '@/lib/supabase/profiles'
import { hasPermission, PERMISSION_CATALOG } from '@/lib/company/permissions'
import { RELEASE_COMPANY_ID, RELEASE_OPERATIONS_ID, RELEASE_LOGISTICS_ID, RELEASE_EXCEPTION_IDS } from '@/lib/company/release-access'
type Role = 'staff'|'approver'|'substitute'|'operations'|'logistics'|'logistics-approver'|'developer'|'owner'|'ceo'
let currentRole = (new URLSearchParams(location.search).get('role') || 'staff') as Role
export const releaseFixture = { get role(){ return currentRole }, approvalError:new URLSearchParams(location.search).has('approval-error'), reads:[] as string[], writes:[] as string[], setRole:(_role:Role)=>{}, refresh:()=>{} }
Object.assign(window,{__releaseFixture:releaseFixture})
export function fixtureProfile(role = currentRole) {
  const index = ['developer','owner','ceo'].indexOf(role)
  return {
    id:index>=0?RELEASE_EXCEPTION_IDS[index]:'fixture-user',email:index>=0?'owner@example.invalid':'staff@example.invalid',displayName:role,
    companyId:RELEASE_COMPANY_ID,status:'active',departmentId:role==='operations'?RELEASE_OPERATIONS_ID:role.startsWith('logistics')?RELEASE_LOGISTICS_ID:'other-department',
    departmentName:role==='operations'?'운영지원팀':'물류팀',position:'사원',jobGrade:'사원',isAdmin:true,capabilities:[],memberships:[],
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
