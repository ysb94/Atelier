import type { Profile } from '../../src/lib/supabase/profiles'
import { legacyPermissionGrants } from '../../src/lib/company/permission-rollout'
import { PERMISSION_CATALOG, permissionLabel, type PermissionGrant } from '../../src/lib/company/permissions'

type Row = Record<string, any>
export type Snapshot = { capturedAt:string; data:Record<string,Row[]>; fingerprints:Record<string,string>; routines:Row[]; policies:Row[]; triggers:Row[]; tableSecurity:Row[]; columns:Row[]; newPermissionDbPresent:boolean }

export function originalProfile(row: Row, data: Snapshot['data']): Profile {
  const department = data.departments.find(d=>d.id===row.department_id && d.company_id===row.company_id)
  return {
    ...row, id:row.id, email:row.email, displayName:row.display_name, companyId:row.company_id,
    departmentId:row.department_id, departmentName:department?.name ?? null, departmentPersonnelScope:department?.personnel_scope ?? null,
    position:row.position, jobGrade:row.job_grade, isAdmin:row.is_admin, status:row.status,
    capabilities:data.capabilities.filter(c=>c.profile_id===row.id).map(c=>c.capability),
    memberships:data.memberships.filter(m=>m.profile_id===row.id).map(m=>({brandId:m.brand_id,isLead:m.is_lead})),
  } as Profile
}

const key = (g:PermissionGrant) => `${g.permission}:${g.scopeKind}:${g.scopeId}`
export function previousGrants(profile:Profile, data:Snapshot['data']) {
  const grants = legacyPermissionGrants(profile)
  if (profile.status==='active') {
    for (const a of data.approvers) if (a.company_id===profile.companyId && [a.approver_id,a.substitute_id].includes(profile.id)) grants.push({permission:'attendance.manage',scopeKind:'department',scopeId:a.department_id})
    for (const e of data.partnerEditors) if (e.profile_id===profile.id && data.brands.some(b=>b.id===e.brand_id && b.company_id===profile.companyId)) grants.push({permission:'partner.edit',scopeKind:'partner',scopeId:e.usage_target_id})
  }
  return [...new Map(grants.map(g=>[key(g),g])).values()]
}

/** Synthetic identities never have a UUID/account/token and never enter the real personnel/approver store. */
export function createBots(data:Snapshot['data']) {
  return data.departments.flatMap((d:Row) => {
    const titles = [...new Set(['직책 미지정', ...data.titles.filter(t=>t.company_id===d.company_id && t.kind==='duty').sort((a,b)=>a.sort_order-b.sort_order).map(t=>t.name), ...data.profiles.filter(p=>p.company_id===d.company_id && p.position).map(p=>p.position)])]
    return titles.map(position=>({
      id:`bot:${d.company_id}:${d.id}:${encodeURIComponent(position)}`, isVirtual:true,
      name:`[봇] ${d.name} · ${position}`, companyId:d.company_id, departmentId:d.id, departmentName:d.name,
      departmentActive:d.is_active, position, status:'active', jobGrade:null, permissionGrants:[] as PermissionGrant[],
    }))
  })
}

export function transitionReport(snapshot:Snapshot, seeded:Row[], checks:Row[]) {
  const data=snapshot.data
  const scopeName = (kind:string,id:string) => kind==='company'?'회사 전체':(kind==='department'?data.departments:kind==='brand'?data.brands:kind==='partner'?data.partners:data.chatRooms).find(r=>r.id===id)?.name ?? '대상 확인 필요'
  const describe = (g:PermissionGrant) => ({...g,label:permissionLabel(g.permission),scopeName:scopeName(g.scopeKind,g.scopeId)})
  const people = data.profiles.map(row=>{
    const profile=originalProfile(row,data)
    const previous=previousGrants(profile,data)
    const next=seeded.filter(g=>g.profile_id===row.id).map(g=>({permission:g.permission,scopeKind:g.scope_kind,scopeId:g.scope_id} as PermissionGrant))
    const added=next.filter(g=>!previous.some(old=>key(old)===key(g)))
    const removed=previous.filter(g=>!next.some(after=>key(after)===key(g)))
    return {id:row.id,name:row.display_name ?? '이름 미등록',companyId:row.company_id,department:profile.departmentName ?? '미지정',position:row.position,grade:row.job_grade,status:row.status,
      previous:previous.map(describe),next:next.map(describe),added:added.map(describe),removed:removed.map(describe),
      notes:added.some(g=>g.permission==='permissions.manage')?['최초 권한 관리자 후보: 기존 관리자에서 이관 예정. 사용자 확인 전 확정 금지.']:[],
    }
  })
  const name=(id:string|null)=>id?people.find(p=>p.id===id)?.name ?? '현재 명부에 없음':'미지정'
  return {capturedAt:snapshot.capturedAt,generatedAt:new Date().toISOString(),databaseChanged:false,readOnly:true,
    comparisonLimit:'기존 앱 코드의 권한 표현과 준비된 SQL의 이관 결과 비교입니다. 모든 업무의 실제 서버 접근 권한을 전수 재현한 결과는 아닙니다.',
    people,departments:data.departments.map(d=>({id:d.id,name:d.name,companyId:d.company_id,isActive:d.is_active})),
    titles:data.titles.map(t=>({companyId:t.company_id,kind:t.kind,name:t.name})),bots:createBots(data),
    permissions:PERMISSION_CATALOG.map(([code,label,group,scopes])=>({code,label,group,scopes:scopes.split(',')})),
    approvers:data.approvers.map(a=>({department:scopeName('department',a.department_id),type:a.request_type,approver:name(a.approver_id),substitute:name(a.substitute_id),preserved:true})),
    checks,counts:{profiles:people.length,departments:data.departments.length,approvers:data.approvers.length,bots:createBots(data).length},
    blockers:people.flatMap(p=>[...p.added.filter(g=>g.permission!=='permissions.manage').map(g=>`${p.name}: 추가 예정 ${g.label} · ${g.scopeName}`),...p.removed.map(g=>`${p.name}: 제외 예정 ${g.label} · ${g.scopeName}`)]),
  }
}
