import type { DraftInformationField, InformationEdits } from '@/lib/drafts/color-spec'
import { getSupabase } from './client'

export type DraftInformationTemporary = {
  field: DraftInformationField
  color_id: string | null
  revision: string
  edits: InformationEdits
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
