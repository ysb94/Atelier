import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { startWorkflow } from '@/lib/diagnostics/workflow-trace'
import { readPollInterval, sharedReadPolicy } from '@/lib/query/shared-read-policy'
import { useAuth } from '@/lib/supabase/auth'
import { changeDraftPrice, draftPriceErrorCode, listDraftPriceRequests, type DraftPriceChange, type DraftPriceRequest, type DraftPriceScope } from '@/lib/supabase/draft-price-requests'
import { emptyList } from '@/lib/utils'

export function useDraftPriceRequests(scope: DraftPriceScope) {
  const { profile, session } = useAuth()
  const active = useWorkspaceTabActivity()
  const accountId = session?.user.id
  const authenticated = Boolean(profile?.companyId && profile.status === 'active' && profile.id === accountId)
  const enabled = active && authenticated
  const account = ['draft-price-requests', profile?.companyId, accountId] as const
  const queryKey = [...account, scope] as const
  const cache = useQueryClient()
  const query = useQuery({
    queryKey, queryFn: ({ signal }) => listDraftPriceRequests(scope, signal), enabled,
    ...sharedReadPolicy, staleTime: 0, refetchInterval: readPollInterval(30_000, enabled),
  })
  const mutation = useMutation({
    mutationFn: async (input: DraftPriceChange) => {
      const trace = startWorkflow('app', `draft_price_${input.action}`)
      trace.step('check_access')
      if (!enabled || (scope === 'china') !== (input.action === 'reply')) {
        trace.block('invalid_scope')
        throw new Error('현재 화면에서는 단가요청을 처리할 수 없습니다.')
      }
      trace.step('validate_input')
      let saved: DraftPriceRequest
      try {
        saved = await trace.run('save', context => changeDraftPrice(input, context))
      } catch (error) {
        trace.fail(error)
        void cache.invalidateQueries({ queryKey: account })
        if (draftPriceErrorCode(error) === '40001' && input.action === 'request') {
          void cache.invalidateQueries({ queryKey: ['product-drafts', 'company', profile?.companyId] })
        }
        throw error
      }
      try {
        await trace.run('refresh_queries', async () => {
          await cache.cancelQueries({ queryKey, exact: true })
          cache.setQueryData<DraftPriceRequest[]>(queryKey, current => {
            const rows = current ?? []
            const alreadyNewer = rows.some(row => row.draftId === saved.draftId && (
              (!saved.answeredAt && (row.round > saved.round || (row.id === saved.id && row.answeredAt)))
              || (row.round > saved.round && row.answeredAt)
            ))
            if (alreadyNewer) return rows
            return [...rows.filter(row => row.id !== saved.id && (
              row.draftId !== saved.draftId || row.round > saved.round || (!saved.answeredAt && row.answeredAt)
            )), saved]
          })
          await cache.invalidateQueries({ queryKey: account }, { throwOnError: true })
        }, { writeOutcome: 'committed' })
        trace.done({ writeOutcome: 'committed' })
      } catch (error) {
        trace.fail(error, { writeOutcome: 'committed' })
      }
      return saved
    },
  })
  const canRead = authenticated && draftPriceErrorCode(query.error) !== '42501'
  return { requests: (canRead ? query.data : undefined) ?? emptyList<DraftPriceRequest>(), query, change: mutation.mutateAsync }
}
