import { diagnosticQuery } from './diagnostic-query'
import type { DiagnosticContext } from '@/lib/diagnostics/workflow-trace'
import { getSupabase } from './client'

export type DraftFolderOrder = { brand_id: string; folder_ids: string[]; revision: string }

export function listDraftFolderOrder(brandId: string, signal: AbortSignal) {
  return diagnosticQuery<DraftFolderOrder | null>('app', 'draft_folder_order_read', getSupabase()
    .from('draft_folder_orders').select('brand_id,folder_ids,revision').eq('brand_id', brandId).abortSignal(signal).maybeSingle())
}

export function saveDraftFolderOrder(brandId: string, folderIds: string[], revision: string | null, context: DiagnosticContext) {
  return diagnosticQuery<DraftFolderOrder>('app', 'draft_folder_order_save', getSupabase().rpc('save_draft_folder_order', {
    p_brand: brandId, p_folder_ids: folderIds, p_revision: revision,
  }), context)
}
