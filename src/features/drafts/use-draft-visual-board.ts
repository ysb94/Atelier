import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { useDraftLoading } from './DraftLoading'
import { RELEASE_VISUAL_ID } from '@/lib/company/release-access'
import { listDraftVisualStatus, saveDraftVisualContent, type DraftVisualStatus } from '@/lib/supabase/draft-visual-content'
import { listOrgChartMembers } from '@/lib/supabase/profiles'

export const draftVisualBoardKey = (actorId: string | undefined) => ['draft-visual-board', actorId] as const

export type DraftVisualBoardRow = {
  status?: DraftVisualStatus
  ready: boolean
  employees?: { id: string; name: string }[]
  directoryError: boolean
  requestDirectory: () => void
  retryDirectory: () => void
  saveAssignees: (assignees: string[], revision: string | null) => Promise<void>
}

export function useDraftVisualBoard(actorId: string | undefined, drafts: readonly { id: string }[], enabled = true) {
  const active = useWorkspaceTabActivity()
  const client = useQueryClient()
  const [directoryRequested, setDirectoryRequested] = useState(false)
  const ids = useMemo(() => drafts.map(draft => draft.id).sort(), [drafts])
  const key = [...draftVisualBoardKey(actorId), ids] as const
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => listDraftVisualStatus(ids, signal),
    enabled: active && enabled && Boolean(actorId) && ids.length > 0, retry: false, staleTime: 30_000 })
  const byDraft = useMemo(() => new Map(query.data?.map(row => [row.draft_id, row])), [query.data])
  const directory = useQuery({ queryKey: ['orgChartMembers', actorId], queryFn: listOrgChartMembers, retry: false, staleTime: 15_000,
    enabled: active && enabled && Boolean(actorId) && (directoryRequested || Boolean(query.data?.some(row => row.assignee_ids.length))) })
  useDraftLoading(directory.isLoading && 'Visual 팀 담당자를 불러오는 중…')
  const employees = useMemo(() => directory.data?.flatMap(member => {
    const name = member.displayName?.trim()
    return member.departmentId === RELEASE_VISUAL_ID && name ? [{ id: member.id, name }] : []
  }), [directory.data])

  function forDraft(draftId: string): DraftVisualBoardRow {
    const status = byDraft.get(draftId)
    return { status, ready: query.isSuccess && Boolean(status), employees, directoryError: directory.isError,
      requestDirectory: () => setDirectoryRequested(true), retryDirectory: () => { void directory.refetch() },
      async saveAssignees(assignees, revision) {
        try {
          const [result] = await saveDraftVisualContent(draftId, [{ kind: 'assignees', entry_key: 'team', payload: assignees, revision }])
          if (result?.kind !== 'assignees') throw new Error('담당자를 저장하지 못했습니다.')
          await client.cancelQueries({ queryKey: key, exact: true })
          client.setQueryData<DraftVisualStatus[]>(key, current => current?.map(row => row.draft_id === draftId
            ? { ...row, assignee_ids: result.payload, assignee_revision: result.revision } : row))
          void client.invalidateQueries({ queryKey: draftVisualBoardKey(actorId) })
        } catch (error) {
          if ((error as { code?: string })?.code === '40001') void client.invalidateQueries({ queryKey: key, exact: true })
          throw error
        }
      },
    }
  }
  return { forDraft, query }
}
