import { diagnosticOperation } from '@/lib/diagnostics'
import { tracedQuery } from '@/lib/diagnostics/workflow-trace'
import { getSupabase } from './client'

export type VendorHtml = { top: string; bottom: string; vendorName?: string }
export type DraftVendorHtml = Partial<Record<string, VendorHtml>>

type Entry =
  | { kind: 'color-html' | 'color-photo'; payload: string }
  | { kind: 'vendor-html'; payload: VendorHtml }
  | { kind: 'assignees'; payload: string[] }

export type DraftVisualContent = Entry & { entry_key: string; revision: string }
export type DraftVisualChange = Entry & { entry_key: string; revision: string | null; draft_revision?: string }

export type DraftVisualStatus = {
  draft_id: string
  saved_images: string[]
  saved_html: string[]
  temporary_images: string[]
  temporary_html: string[]
  assignee_ids: string[]
  assignee_revision: string | null
}

export async function listDraftVisualStatus(ids: string[], signal: AbortSignal) {
  const rows: DraftVisualStatus[] = []
  for (let offset = 0; offset < ids.length; offset += 80) {
    const { data, error } = await getSupabase().rpc('list_draft_visual_status', {
      p_draft_ids: ids.slice(offset, offset + 80),
    }).abortSignal(signal)
    if (error) throw error
    rows.push(...((data ?? []) as DraftVisualStatus[]))
  }
  return rows
}

export async function listDraftVisualContent(draftId: string, signal: AbortSignal) {
  const { data, error } = await getSupabase().from('draft_visual_content')
    .select('kind,entry_key,revision,payload').eq('draft_id', draftId).in('kind', ['color-html', 'color-photo', 'vendor-html']).abortSignal(signal)
  if (error) throw error
  return (data ?? []) as DraftVisualContent[]
}

export async function saveDraftVisualContent(draftId: string, changes: DraftVisualChange[], temporaryRevision?: string) {
  return diagnosticOperation('app', 'save-draft-visual-content', async trace => {
    return trace.run('save', async context => {
      const { data, error } = await tracedQuery(getSupabase().rpc('save_draft_visual_content', {
        p_draft_id: draftId, p_changes: changes, p_temporary_revision: temporaryRevision ?? null,
      }), context)
      if (error) throw error
      return (data ?? []) as DraftVisualContent[]
    })
  })
}

export function draftVisualSaveError(error: unknown) {
  const code = (error as { code?: string } | null)?.code
  if (code === '40001') return '다른 화면에서 먼저 저장했습니다. 입력값을 복사한 뒤 팝업을 다시 열어 주세요.'
  if (code === '42501') return '이 기획안을 편집할 권한이 없습니다.'
  if (code === '23514') return 'HTML 용량 또는 이미지 형식을 확인해 주세요.'
  if (code === '22023') return '컬러, 업체 또는 담당자 정보를 다시 확인해 주세요.'
  return '저장하지 못했습니다. 입력값을 유지했습니다.'
}
