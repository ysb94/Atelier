import type { PermissionCode, PermissionGrant } from './permissions'

/** 화면 테스트 사례에 권한을 명시한다. 직책·직급을 바꿔도 이 지정 내역은 바뀌지 않는다. */
export function casePermissionGrants(id: string, pathname: string, companyId: string, capabilities: readonly string[] = []): PermissionGrant[] {
  const codes = new Set<PermissionCode>(['basic.use'])
  const add = (...items: PermissionCode[]) => items.forEach(item => codes.add(item))
  for (const key of capabilities) if (['planning','design','md','logistics','data'].includes(key)) add(`data.${key}` as PermissionCode)
  if (['manager','executive'].includes(id)) add('work.manage','drafts.read')
  if (['executive','reviewer'].includes(id)) add('attendance.exempt')
  if (['reviewer','reviewer-admin','reviewer-lead'].includes(id)) add('company.review','ideas.read')
  if (['personnel','personnel-member'].includes(id)) add('personnel.manage')
  if (['editor','operations','operations-lead'].includes(id) && ['/', '/operations-support','/members'].includes(pathname)) add('org.manage','approvers.manage','notice.company.write','notice.company.delete')
  if (id === 'editor' && pathname === '/members') add('personnel.manage')
  if (id === 'operations-lead') add('personnel.manage')
  if (id === 'admin' && pathname === '/members') add('system.manage','personnel.manage')
  if (id === 'department-approver') add('attendance.manage')
  if (id === 'reviewer-admin') add('brand.manage','brand.edit')
  if (['brand-lead','reviewer-lead','lead'].includes(id)) add(pathname === '/settings/ai' ? 'ai.manage' : 'brand.edit')
  if (id === 'editor' && pathname === '/settings/ai') add('ai.manage')
  if (id === 'partner-manager') add('partner.manage','partner.edit')
  if (id === 'partner-editor') add('partner.edit')
  if (id === 'chat-manager') add('chat.moderate')
  if (id === 'chat-admin') add('system.manage')
  if (id === 'admin' && pathname === '/meetings') add('meeting.manage')
  return [...codes].map(permission => ({ permission, scopeKind: 'company', scopeId: companyId }))
}
