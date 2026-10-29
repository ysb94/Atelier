import { hasPermission, type PermissionProfile } from './permissions'

export function assignedDepartmentIds(settings: readonly { departmentId: string; approverId: string | null; substituteId: string | null }[], userId: string | undefined) {
  if (!userId) return [] as string[]
  return [...new Set(settings.flatMap(item => item.approverId === userId || item.substituteId === userId ? [item.departmentId] : []))]
}

/** My home에서는 승인자 지정만, 운영지원에서는 기존 출근시간 권한도 확인한다. */
export function canManageDepartmentAttendance(profile: PermissionProfile | null | undefined, assignedDepartmentIds: readonly string[], departmentId: string | null | undefined, assignedOnly = false) {
  return Boolean(profile?.status === 'active' && departmentId && (
    assignedDepartmentIds.includes(departmentId) || (!assignedOnly && hasPermission(profile, 'attendance.manage', 'department', departmentId))
  ))
}
