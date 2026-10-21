/** 권한 RPC의 실제 지정 내역만 사용한다. 직책·직급·기존 관리자 값은 보지 않는다. */
export function hasAssignedPermission(grants: unknown, permission: string, companyId: string, scopeKind: string, scopeId: string): boolean {
  return Array.isArray(grants) && grants.some(grant => grant && typeof grant === 'object' &&
    grant.permission === permission && (grant.scopeKind === 'company' && grant.scopeId === companyId || grant.scopeKind === scopeKind && grant.scopeId === scopeId))
}
