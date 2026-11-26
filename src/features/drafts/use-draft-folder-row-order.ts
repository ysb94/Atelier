import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { diagnosticOperation } from '@/lib/diagnostics/workflow-trace'
import { readPollInterval, sharedReadPolicy } from '@/lib/query/shared-read-policy'
import { getSupabase } from '@/lib/supabase/client'
import { getDraftFolderRowOrder, saveDraftFolderRowOrder } from '@/lib/supabase/draft-folder-row-order'

function errorCode(error: unknown) {
  return error instanceof Error ? (error.cause as { code?: string } | undefined)?.code : undefined
}

export function useDraftFolderRowOrder(folderId: string | undefined, actorId: string | undefined, companyId: string) {
  const active = useWorkspaceTabActivity()
  const cache = useQueryClient()
  const enabled = Boolean(active && folderId && actorId)
  const queryKey = ['draft-folder-row-order', companyId, actorId, folderId] as const
  const query = useQuery({
    queryKey, queryFn: ({ signal }) => getDraftFolderRowOrder(folderId!, signal), enabled, ...sharedReadPolicy,
    refetchInterval: readPollInterval(30_000, enabled),
  })
  const ready = query.isSuccess && enabled
  const { mutateAsync, isPending } = useMutation({
    mutationKey: queryKey,
    mutationFn: ({ ids, revision, key }: { ids: string[]; revision: string | null; key: typeof queryKey }) =>
      diagnosticOperation('app', 'reorder_drafts_in_folder', async trace => {
        trace.step('validate_input', { count: ids.length })
        const saved = await trace.run('save', context => saveDraftFolderRowOrder(key[3]!, ids, revision, context))
        trace.done({ writeOutcome: 'committed' })
        return saved
      }),
    onSuccess: async (saved, { key }) => {
      await cache.cancelQueries({ queryKey: key, exact: true })
      cache.setQueryData(key, saved)
      void cache.invalidateQueries({ queryKey: key, exact: true })
    },
  })

  useEffect(() => {
    if (!ready || !folderId) return
    const db = getSupabase()
    const refreshOrder = () => void cache.invalidateQueries({
      queryKey: ['draft-folder-row-order', companyId, actorId, folderId], exact: true,
    })
    const refresh = () => {
      refreshOrder()
      void cache.invalidateQueries({ queryKey: ['product-drafts', 'company', companyId], exact: true })
    }
    const filter = { schema: 'public', table: 'draft_folder_row_orders', filter: `season_id=eq.${folderId}` }
    const channel = db.channel(`draft-folder-row-order:${folderId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', ...filter }, refresh)
      .on('postgres_changes', { event: 'UPDATE', ...filter }, refresh)
      .subscribe(status => { if (status === 'SUBSCRIBED') refreshOrder() })
    return () => { void db.removeChannel(channel) }
  }, [actorId, cache, companyId, folderId, ready])

  async function reorder(ids: string[]) {
    if (!ready || isPending) return
    try {
      await mutateAsync({ ids, revision: query.data?.revision ?? null, key: queryKey })
    } catch (cause) {
      if (errorCode(cause) === '40001') {
        await Promise.all([
          cache.invalidateQueries({ queryKey, exact: true }),
          cache.invalidateQueries({ queryKey: ['product-drafts', 'company', companyId], exact: true }),
        ])
        throw new Error('폴더 목록이나 순서가 변경되었습니다. 최신 순서를 확인하고 다시 옮겨 주세요.', { cause })
      }
      if (errorCode(cause) === '42501') throw new Error('이 폴더의 기획안 순서를 변경할 권한이 없습니다.', { cause })
      void cache.invalidateQueries({ queryKey, exact: true })
      throw new Error('기획안 순서를 저장하지 못했습니다. 다시 시도해 주세요.', { cause })
    }
  }

  const missing = ['PGRST205', '42P01'].includes(errorCode(query.error) ?? '')
  return {
    ids: query.data?.draft_ids,
    ready,
    isPending,
    error: query.isError ? (missing ? '기획안 순서 공유 연결 대기' : '저장된 기획안 순서를 불러오지 못했습니다.') : '',
    reorder,
  }
}
