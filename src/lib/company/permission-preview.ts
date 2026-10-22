import type { PermissionCode, PermissionGrant } from './permissions'

/** 표시용 지정만 만든다. 부서 담당 범위를 실제 로그인 권한에 쓰지 않는다. */
export function previewPermissionGrants(codes: readonly PermissionCode[], companyId: string, department?: { id: string | null; name: string } | null): PermissionGrant[] {
  return [...new Set<PermissionCode>(['basic.use',...codes])].map(permission=>{
    const scoped=department?.id && ['work.manage','attendance.manage','notice.department.write','notice.department.delete'].includes(permission)
    return {permission,scopeKind:scoped?'department':'company',scopeId:scoped?department.id!:companyId,scopeName:scoped?department.name:undefined}
  })
}
