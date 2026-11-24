import type { DraftInformationField, InformationEdits } from '@/lib/drafts/color-spec'
import { getSupabase } from './client'

export type DraftInformationTemporary = {
  field: DraftInformationField | 'html' | 'image'
  color_id: string | null
  revision: string
  edits: InformationEdits & {
    html?: { source: string; text: string }
    image?: { source: string; text: string; draftRevision?: string }
  }
}

export type DraftInformationTemporaryStore = {
  list: (draftId: string, editorId: string, signal: AbortSignal) => Promise<DraftInformationTemporary[]>
  save: (draftId: string, editorId: string, workingCopy: DraftInformationTemporary) => Promise<void>
}

export const draftInformationTemporaryStore: DraftInformationTemporaryStore = {
  async list(draftId, editorId, signal) {
    const { data, error } = await getSupabase().from('draft_information_temporary')
      .select('field,color_id,revision,edits').eq('draft_id', draftId).eq('editor_id', editorId).abortSignal(signal)
    if (error) throw error
    return (data ?? []) as DraftInformationTemporary[]
  },

  async save(draftId, editorId, workingCopy) {
    const { error } = await getSupabase().from('draft_information_temporary')
      .upsert({ ...workingCopy, draft_id: draftId, editor_id: editorId }, { onConflict: 'draft_id,editor_id,field,color_id' })
    if (error) throw error
  },
}

export async function listDraftSpecDocumentTemporarySources(draftIds: string[], editorId: string, signal: AbortSignal) {
  const rows: { draft_id: string; source: string }[] = []
  for (let offset = 0; offset < draftIds.length; offset += 80) {
    const { data, error } = await getSupabase().from('draft_information_temporary')
      .select('draft_id,source:edits->specDoc->>source')
      .eq('editor_id', editorId).eq('field', 'specDoc').is('color_id', null)
      .not('edits->specDoc->>source', 'is', null)
      .in('draft_id', draftIds.slice(offset, offset + 80)).abortSignal(signal)
    if (error) throw error
    rows.push(...(data ?? []))
  }
  return rows
}
