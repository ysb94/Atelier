import { useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { canAccessOperationsSupport, canEditOrgAssignment } from '@/lib/company/capabilities'
import { emptyList } from '@/lib/utils'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { listAttendanceStartSettings, saveAttendanceStartSettings, type SaveAttendanceStart } from '@/lib/supabase/attendance-start-settings'
import { attendanceStartIndex, type AttendanceStartSetting } from './attendance-start-settings'

export function useAttendanceStartSettings(options?: { assigned?: boolean }) {
  const { profile, session } = useAuth()
  const assigned = options?.assigned === true
  const allowed = canAccessOperationsSupport(profile) || (assigned && profile?.status === 'active')
  const canEdit = canEditOrgAssignment(profile)
  const active = useWorkspaceTabActivity()
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['attendance-start-settings',session?.user.id,allowed], queryFn: listAttendanceStartSettings,
    enabled: allowed, refetchInterval: allowed && active ? 30_000 : false })
  useEffect(() => { if(query.error) console.warn('[attendance-start] 출근시간 불러오기 실패',query.error) }, [query.error])
  const settings = allowed ? query.data ?? emptyList<AttendanceStartSetting>() : emptyList<AttendanceStartSetting>()
  const index = useMemo(() => attendanceStartIndex(settings), [settings])
  const save = useMutation({ mutationFn: (input: SaveAttendanceStart) => {
    if (assigned && !input.employeeId) throw new Error('직원별로 출근시간을 저장해 주세요.')
    if (!canEdit && !assigned) throw new Error('담당 부서 승인자만 출근시간을 저장할 수 있습니다.')
    return saveAttendanceStartSettings(input)
  }, onSuccess: () => client.invalidateQueries({queryKey:['attendance-start-settings']}) })
  return { settings, index, save, allowed, canEdit, loading: allowed && query.isPending, error: query.error, refresh: () => query.refetch() }
}
