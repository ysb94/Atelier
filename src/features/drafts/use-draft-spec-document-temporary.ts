import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { listDraftSpecDocumentTemporarySources } from '@/lib/supabase/draft-information-temporary'

export const draftSpecDocumentTemporaryKey = (editorId: string | undefined) =>
  ['draft-spec-document-temporary', editorId] as const

export function useDraftSpecDocumentTemporary(
  editorId: string | undefined,
  drafts: readonly { id: string }[],
) {
  const active = useWorkspaceTabActivity()
  const ids = useMemo(() => drafts.map(draft => draft.id).sort(), [drafts])
  const query = useQuery({
    queryKey: [...draftSpecDocumentTemporaryKey(editorId), ids],
    queryFn: ({ signal }) => listDraftSpecDocumentTemporarySources(ids, editorId!, signal),
    enabled: active && Boolean(editorId) && ids.length > 0,
    retry: false,
  })
  return useMemo(() => new Map(query.data?.map(row => [row.draft_id, row.source])), [query.data])
}
