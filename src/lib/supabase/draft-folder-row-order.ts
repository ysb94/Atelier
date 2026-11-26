import { diagnosticQuery } from './diagnostic-query'
import type { DiagnosticContext } from '@/lib/diagnostics/workflow-trace'
import { getSupabase } from './client'

type DraftFolderRowOrder = { season_id: string; draft_ids: string[]; revision: string }

export function getDraftFolderRowOrder(folderId: string, signal: AbortSignal) {
  return diagnosticQuery<DraftFolderRowOrder | null>('app', 'draft_folder_row_order_read', getSupabase()
    .from('draft_folder_row_orders').select('season_id,draft_ids,revision').eq('season_id', folderId).abortSignal(signal).maybeSingle())
}

export function saveDraftFolderRowOrder(folderId: string, draftIds: string[], revision: string | null, context: DiagnosticContext) {
  return diagnosticQuery<DraftFolderRowOrder>('app', 'draft_folder_row_order_save', getSupabase()
    .rpc('save_draft_folder_row_order', { p_folder: folderId, p_draft_ids: draftIds, p_revision: revision }), context)
}
