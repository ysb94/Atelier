import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { startWorkflow } from '@/lib/diagnostics/workflow-trace'
import { readPollInterval, sharedReadPolicy } from '@/lib/query/shared-read-policy'
import {
  addDraftPriceDestination, draftPriceErrorCode, listDraftPriceDestinations, type SharedDraftPriceDestination,
} from '@/lib/supabase/draft-price-requests'

export function useDraftPriceDestinations(companyId: string, actorId: string | undefined, authenticated: boolean) {
  const active = useWorkspaceTabActivity()
  const enabled = active && authenticated
  const cache = useQueryClient()
  const queryKey = ['draft-price-destinations', companyId, actorId] as const
  const query = useQuery({
    queryKey, queryFn: ({ signal }) => listDraftPriceDestinations(signal), enabled,
    ...sharedReadPolicy, refetchInterval: readPollInterval(30_000, enabled),
  })
  const code = draftPriceErrorCode(query.error)
  const error = code === 'PGRST205' || code === '42P01'
    ? '공용 제조국 서버 연결 대기'
    : query.isError ? '공용 제조국을 불러오지 못했습니다.' : ''

  return {
    rows: enabled ? query.data : undefined,
    error,
    ready: enabled && query.isSuccess,
    retry: () => { void query.refetch() },
    async add(draftId: string, rawName: string) {
      const trace = startWorkflow('app', 'draft_price_destination_add')
      trace.step('check_access')
      if (!enabled || !query.isSuccess) {
        trace.block('not_ready')
        throw new Error('공용 제조국 목록을 먼저 확인해 주세요.')
      }
      trace.step('validate_input')
      const name = rawName.trim().replace(/\s+/g, ' ')
      if (!name || name.length > 40) {
        trace.block('invalid_name')
        throw new Error('제조국 이름을 1~40자로 입력해 주세요.')
      }
      let row: SharedDraftPriceDestination
      try {
        row = await trace.run('save', context => addDraftPriceDestination(draftId, name, context))
      } catch (cause) {
        trace.fail(cause)
        if (draftPriceErrorCode(cause) === '23505') {
          void cache.invalidateQueries({ queryKey })
          throw new Error('이미 등록된 제조국입니다.')
        }
        if (draftPriceErrorCode(cause) === '23514') throw new Error('기본 버튼과 다른 제조국 이름을 입력해 주세요.')
        if (draftPriceErrorCode(cause) === '42501') throw new Error('공용 제조국을 추가할 권한이 없습니다.')
        throw new Error('제조국을 추가하지 못했습니다. 목록을 확인하고 다시 시도해 주세요.')
      }
      await trace.run('refresh_queries', async () => {
        await cache.cancelQueries({ queryKey, exact: true })
        cache.setQueryData<SharedDraftPriceDestination[]>(queryKey, current => [...(current ?? []).filter(item => item.id !== row.id), row])
        void cache.invalidateQueries({ queryKey, exact: true })
      }, { writeOutcome: 'committed' })
      trace.done({ writeOutcome: 'committed' })
      return row
    },
  }
}
