import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { readImpersonationState } from '@/lib/supabase/impersonation'
import { listMyLeaveUsageNotices, recordLeaveUsageNotice, type LeaveUsageNotice } from '@/lib/supabase/leave-usage-notices'
import { emptyList } from '@/lib/utils'

export function useLeaveUsageNotices() {
  const { profile, session } = useAuth()
  const preview = usePagePreview()
  const enabled = Boolean(profile?.status === 'active' && session?.user.id === profile.id && !preview?.active)
  const impersonation = enabled ? readImpersonationState() : null
  const canConfirm = enabled && !impersonation
  const employeeId = profile?.id
  const cache = useQueryClient()
  const query = useQuery({ queryKey: ['leave-usage-notices', employeeId], queryFn: () => listMyLeaveUsageNotices(employeeId!), enabled, refetchInterval: enabled ? 30_000 : false })
  const [activeId, setActiveId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  useEffect(() => { setActiveId(null); setActionError(null) }, [employeeId])
  useEffect(() => { if (query.error) console.warn('[leave-notices] 본인 연차 안내 조회 실패', { error: query.error, employeeId }) }, [query.error, employeeId])
  const records = enabled ? query.data ?? emptyList<LeaveUsageNotice>() : emptyList<LeaveUsageNotice>()
  async function record(id: string | null, action: 'read' | 'view' | 'confirm') {
    if (!canConfirm || busy) return false
    setBusy(true); setActionError(null)
    try {
      await recordLeaveUsageNotice(id, action)
      await Promise.all([cache.invalidateQueries({ queryKey: ['leave-usage-notices', employeeId] }), cache.invalidateQueries({ queryKey: ['leave-notice-management'] })])
      return true
    } catch (error) {
      console.warn('[leave-notices] 확인 기록 저장 실패', { action, id, error })
      setActionError(error instanceof Error ? error.message : '확인 기록을 저장하지 못했습니다. 다시 시도해 주세요.')
      return false
    } finally { setBusy(false) }
  }
  return {
    records, enabled, canConfirm, busy, active: records.find(row => row.id === activeId),
    error: actionError ?? (query.error ? '연차 안내를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' : null),
    async open(id: string) { if (!records.some(row => row.id === id)) return; if (!canConfirm || await record(id, 'view')) setActiveId(id) },
    close() { setActiveId(null) },
    confirm(id: string) { return record(id, 'confirm') },
    markAllRead() { return record(null, 'read') },
  }
}
export type LeaveUsageNoticeController = ReturnType<typeof useLeaveUsageNotices>
