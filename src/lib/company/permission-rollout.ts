import type { Profile } from '../supabase/profiles'
import type { PermissionCode, PermissionGrant } from './permissions'

/** DB와 Edge 전환을 승인한 뒤에만 켠다. 조회 실패를 전환 신호로 사용하지 않는다. */
export function assignedPermissionsEnabled() {
  return import.meta.env?.VITE_ASSIGNED_PERMISSIONS_ENABLED === 'true'
}

/** 이전 DB와 동작하는 동안만 기존 권한을 화면의 공통 형식으로 표현한다. */
export function legacyPermissionGrants(profile: Profile): PermissionGrant[] {
  if (profile.status !== 'active' || !profile.companyId) return []
  const grants: PermissionGrant[] = []
  const add = (permission: PermissionCode, scopeKind: PermissionGrant['scopeKind'] = 'company', scopeId: string | null = profile.companyId, scopeName?: string | null) => {
    if (scopeId) grants.push({ permission, scopeKind, scopeId, scopeName: scopeName ?? undefined })
  }
  const many = (...codes: PermissionCode[]) => codes.forEach(code => add(code))
  const manager = ['팀장','이사'].includes(profile.position ?? '')
  const developer = profile.email.trim().toLowerCase() === 'dev@atelier.local'
  const reviewer = profile.position === '대표이사'
  const org = developer || profile.departmentName === '운영지원팀'
  add('basic.use')
  if (profile.isAdmin) many('system.manage','personnel.manage','brand.manage','brand.edit','ai.manage','partner.manage','partner.edit','meeting.manage')
  for (const code of ['planning','design','md','logistics','data'] as const) if (profile.isAdmin || profile.capabilities.includes(code)) add(`data.${code}`)
  if (org) many('org.manage','approvers.manage','attendance.manage','notice.company.write','notice.company.delete')
  if (profile.departmentPersonnelScope === 'members' || (profile.departmentPersonnelScope === 'leaders' && manager)) add('personnel.manage')
  if (developer || reviewer) many('preview.use','ideas.read')
  if (reviewer) add('company.review')
  if (manager || reviewer) add('drafts.read')
  if (['대표이사','부사장','전무','상무','이사'].includes(profile.position ?? '')) add('attendance.exempt')
  if (manager) {
    add('chat.moderate')
    add('notice.department.write','department',profile.departmentId,profile.departmentName)
    add('notice.department.delete','department',profile.departmentId,profile.departmentName)
  }
  if (manager || profile.isAdmin) add('work.manage','department',profile.departmentId,profile.departmentName)
  for (const member of profile.memberships) if (member.isLead) for (const code of ['brand.edit','ai.manage','partner.manage','partner.edit'] as const) add(code,'brand',member.brandId)
  return grants
}
