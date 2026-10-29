import { hasPermission, type PermissionProfile } from './permissions'

export function assignedDepartmentIds(settings: readonly { departmentId: string; approverId: string | null; substituteId: string | null }[], userId: string | undefined) {
  if (!userId) return [] as string[]
  return [...new Set(settings.flatMap(item => item.approverId === userId || item.substituteId === userId ? [item.departmentId] : []))]
}

/** 기존 승인자 지정과 명시적인 출근시간 권한을 같은 부서 범위로 확인한다. */
export function canManageDepartmentAttendance(profile: PermissionProfile | null | undefined, assignedDepartmentIds: readonly string[], departmentId: string | null | undefined) {
  return Boolean(profile?.status === 'active' && departmentId && (
    assignedDepartmentIds.includes(departmentId) || hasPermission(profile, 'attendance.manage', 'department', departmentId)
  ))
}
