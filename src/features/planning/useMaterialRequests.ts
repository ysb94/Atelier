import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { emptyList } from '@/lib/utils'
import { readPollInterval } from '@/lib/query/shared-read-policy'
import { startWorkflow } from '@/lib/diagnostics/workflow-trace'
import { readMaterialRequests, writeMaterialRequest, type MaterialScope } from '@/lib/supabase/material-requests'
import type { MaterialRequest } from './MaterialRequestDialog'

export function materialRequestError(error: unknown, fallback: string) {
  const code = error instanceof Error ? (error.cause as { code?: string } | undefined)?.code : undefined
  if (code === 'PGRST202' || code === '42883') return '자재요청 저장 기능이 아직 서버에 연결되지 않았습니다.'
  if (code === '40001') return '다른 화면에서 요청이 변경되었습니다. 목록을 다시 불러왔으니 확인해 주세요.'
  if (code === '42501') return '권한 또는 배정이 변경되었습니다. 목록을 다시 확인해 주세요.'
  if (code === '22023' && error instanceof Error) return error.message
  return fallback
}

export function useMaterialRequests(scope: MaterialScope, { refreshMs }: { refreshMs?: number } = {}) {
  const { profile, session } = useAuth()
  const active = useWorkspaceTabActivity()
  const account = ['material-requests', profile?.companyId ?? '', session?.user.id ?? ''] as const
  const enabled = active && Boolean(account[1] && account[2] && profile?.id === account[2] && profile.status === 'active')
  const query = useQuery({
    queryKey: [...account, scope],
    queryFn: ({ signal }) => readMaterialRequests(scope, signal),
    enabled,
    refetchInterval: refreshMs ? readPollInterval(refreshMs, enabled) : false,
    staleTime: 10_000,
    retry: false,
  })
  const cache = useQueryClient()
  const mutation = useMutation({
    mutationFn: async (input: Parameters<typeof writeMaterialRequest>[0]) => {
      const trace = startWorkflow('app', `material_request_${input.action}`)
      trace.step('validate_input')
      try {
        await trace.run('save', context => writeMaterialRequest(input, context))
      } catch (error) {
        trace.fail(error)
        void cache.invalidateQueries({ queryKey: account })
        throw error
      }
      try {
        await trace.run('refresh', () => Promise.all([
          cache.invalidateQueries({ queryKey: account }, { throwOnError: true }),
          ...(['send', 'assign', 'ship', 'rate'].includes(input.action)
            ? [cache.invalidateQueries({ queryKey: ['china-work-screen'] }, { throwOnError: true })] : []),
        ]), { writeOutcome: 'committed' })
        trace.done()
      } catch (error) {
        trace.fail(error, { writeOutcome: 'committed' })
      }
    },
  })
  return { requests: query.data ?? emptyList<MaterialRequest>(), query, mutation }
}
