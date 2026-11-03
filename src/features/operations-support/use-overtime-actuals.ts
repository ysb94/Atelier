import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { listOvertimeActuals, saveOvertimeActual } from '@/lib/supabase/overtime-actuals'
import { emptyList } from '@/lib/utils'
import type { OvertimeActual } from './overtime-actuals'

export function useOvertimeActuals() {
  const { session, profile } = useAuth()
  const active = useWorkspaceTabActivity()
  const enabled = Boolean(session?.user.id && profile?.status === 'active')
  const cache = useQueryClient()
  const query = useQuery({ queryKey: ['overtime-actuals', session?.user.id, profile?.companyId], queryFn: listOvertimeActuals, enabled, refetchInterval: enabled && active ? 30_000 : false })
  useEffect(() => { if (query.error) console.warn('[overtime-actuals] 조회 오류', query.error) }, [query.error])
  const save = useMutation({ mutationFn: saveOvertimeActual, onSuccess: () => cache.invalidateQueries({ queryKey: ['overtime-actuals'] }) })
  return { ...query, rows: enabled ? query.data?.rows ?? emptyList<OvertimeActual>() : emptyList<OvertimeActual>(), ready: enabled && query.data?.ready === true, save }
}
