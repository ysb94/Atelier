import { useEffect, useMemo, useRef } from 'react'
import { useOpsDirectory } from './ops-directory'

/** 본사 직원 명부와, 출퇴근 제외자를 뺀 근태 집계용 명부를 함께 돌려준다. */
export function useAttendanceDirectory() {
  const source = useOpsDirectory('head-office')
  const { departments, members: allMembers, departmentName, loading, error } = source
  const refetchRef = useRef(source.refetch)
  useEffect(() => { refetchRef.current = source.refetch })
  const members = useMemo(() => allMembers.filter(member => !member.attendanceExempt), [allMembers])
  const directory = useMemo<ReturnType<typeof useOpsDirectory>>(() => ({ departments, members, departmentName, loading, error, refetch: () => refetchRef.current() }), [departments, members, departmentName, loading, error])
  return { source, directory }
}
