import { useEffect } from 'react'
import { useDraftLoading } from './DraftLoading'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { diagnosticOperation } from '@/lib/diagnostics/workflow-trace'
import { readPollInterval, sharedReadPolicy } from '@/lib/query/shared-read-policy'
import { getSupabase } from '@/lib/supabase/client'
import { listDraftFolderOrder, saveDraftFolderOrder } from '@/lib/supabase/draft-folder-order'

function errorCode(error: Error | null) {
  return (error?.cause as { code?: string } | undefined)?.code
}

export function useDraftFolderOrder(brandId: string | undefined, actorId: string | undefined, companyId: string) {
  const active = useWorkspaceTabActivity()
  const cache = useQueryClient()
  const enabled = Boolean(active && brandId && actorId)
  const queryKey = ['draft-folder-order', companyId, actorId, brandId] as const
  const query = useQuery({
    queryKey, queryFn: ({ signal }) => listDraftFolderOrder(brandId!, signal), enabled, ...sharedReadPolicy,
    refetchInterval: readPollInterval(30_000, enabled),
  })
  const available = query.isSuccess && enabled
  const { mutateAsync, isPending } = useMutation({
    mutationKey: queryKey,
    mutationFn: ({ ids, revision, key }: { ids: string[]; revision: string | null; key: typeof queryKey }) =>
      diagnosticOperation('app', 'reorder_draft_folders', async trace => {
        trace.step('validate_input', { count: ids.length })
        const saved = await trace.run('save', context => saveDraftFolderOrder(key[3]!, ids, revision, context))
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
    if (!enabled || !brandId || !available) return
    const db = getSupabase()
    const refresh = () => void cache.invalidateQueries({ queryKey: ['draft-folder-order', companyId, actorId, brandId], exact: true })
    const filter = { schema: 'public', table: 'draft_folder_orders', filter: `brand_id=eq.${brandId}` }
    const channel = db.channel(`draft-folder-order:${brandId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', ...filter }, refresh)
      .on('postgres_changes', { event: 'UPDATE', ...filter }, refresh)
      .subscribe(status => { if (status === 'SUBSCRIBED') refresh() })
    return () => { void db.removeChannel(channel) }
  }, [actorId, available, brandId, cache, companyId, enabled])

  async function reorder(ids: string[]) {
    if (!available || !brandId) return
    try {
      await mutateAsync({ ids, revision: query.data?.revision ?? null, key: queryKey })
    } catch (cause) {
      if (errorCode(cause as Error) === '40001') {
        await Promise.all([
          cache.invalidateQueries({ queryKey, exact: true }),
          cache.invalidateQueries({ queryKey: ['seasons', brandId], exact: true }),
        ])
        throw new Error('다른 화면에서 폴더가 변경되었습니다. 새로 불러온 순서를 확인하고 다시 옮겨 주세요.', { cause })
      }
      if (errorCode(cause as Error) === '42501') throw new Error('이 브랜드의 폴더 순서를 변경할 권한이 없습니다.', { cause })
      void cache.invalidateQueries({ queryKey, exact: true })
      throw new Error('폴더 순서를 저장하지 못했습니다. 다시 시도해 주세요.', { cause })
    }
  }

  const missing = ['PGRST205', '42P01'].includes(errorCode(query.error) ?? '')
  useDraftLoading(query.isLoading && '폴더 순서를 불러오는 중…')
  useDraftLoading(isPending && '폴더 순서를 저장하는 중…', true)
  return {
    ids: query.data?.folder_ids,
    ready: available,
    isPending,
    error: query.isError ? (missing ? '폴더 순서 공유 연결 대기' : '저장된 폴더 순서를 불러오지 못했습니다.') : '',
    reorder,
  }
}
