import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { startWorkflow } from '@/lib/diagnostics/workflow-trace'
import { DRAFT_PRICE_DESTINATIONS, type DraftPriceDestinationOption } from '@/lib/drafts/manual-price'
import { readPollInterval, sharedReadPolicy } from '@/lib/query/shared-read-policy'
import {
  addDraftPriceDestination, changeDraftPriceDestination, draftPriceErrorCode, listDraftPriceDestinations, type SharedDraftPriceDestination,
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
  const error = ['PGRST202', 'PGRST205', '42883', '42P01'].includes(code ?? '')
    ? '공용 제조국 서버 연결 대기'
    : query.isError ? '공용 제조국을 불러오지 못했습니다.' : ''

  async function save(draftId: string, rawName: string | null, option?: DraftPriceDestinationOption) {
    const trace = startWorkflow('app', option ? 'draft_price_destination_change' : 'draft_price_destination_add')
    trace.step('check_access')
    if (!enabled || !query.isSuccess) {
      trace.block('not_ready')
      throw new Error('공용 제조국 목록을 먼저 확인해 주세요.')
    }
    trace.step('validate_input')
    const name = rawName === null ? null : rawName.trim().replace(/\s+/g, ' ')
    if (name !== null && (!name || name.length > 40)) {
      trace.block('invalid_name')
      throw new Error('제조국 이름을 1~40자로 입력해 주세요.')
    }
    // Adding a removed preset by its name restores its original routing key.
    const restored = !option && name ? query.data.find(row => row.removed && row.preset_key &&
      [row.name, DRAFT_PRICE_DESTINATIONS.find(preset => preset.value === row.preset_key)?.label]
        .some(label => label?.toLowerCase() === name.toLowerCase())) : undefined
    const key = option?.value ?? restored?.preset_key
    let row: SharedDraftPriceDestination
    try {
      row = await trace.run('save', context => key
        ? changeDraftPriceDestination(draftId, key, option?.revision ?? restored?.revision ?? null, name, context)
        : addDraftPriceDestination(draftId, name ?? '', context))
    } catch (cause) {
      trace.fail(cause)
      const code = draftPriceErrorCode(cause)
      if (code === '23505' || code === '40001') {
        void cache.invalidateQueries({ queryKey })
        throw new Error(code === '23505' ? '이미 등록된 제조국입니다.' : '다른 화면에서 목록을 변경했습니다. 최신 목록을 확인해 주세요.')
      }
      if (code === '23514') throw new Error('기본 버튼과 다른 제조국 이름을 입력해 주세요.')
      if (code === '42501') throw new Error('공용 제조국 목록을 변경할 권한이 없습니다.')
      throw new Error('공용 제조국 목록을 저장하지 못했습니다. 목록을 확인하고 다시 시도해 주세요.')
    }
    await trace.run('refresh_queries', async () => {
      await cache.cancelQueries({ queryKey, exact: true })
      cache.setQueryData<SharedDraftPriceDestination[]>(queryKey, current => [
        ...(current ?? []).filter(item => item.id !== row.id),
        ...(row.removed && !row.preset_key ? [] : [row]),
      ])
      void cache.invalidateQueries({ queryKey, exact: true })
    }, { writeOutcome: 'committed' })
    trace.done({ writeOutcome: 'committed' })
    return row
  }

  return {
    rows: enabled ? query.data : undefined,
    error,
    ready: enabled && query.isSuccess,
    retry: () => { void query.refetch() },
    add: (draftId: string, name: string) => save(draftId, name),
    change: (draftId: string, option: DraftPriceDestinationOption, name: string | null) => save(draftId, name, option),
  }
}
