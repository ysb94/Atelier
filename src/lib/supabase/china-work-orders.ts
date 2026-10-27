import { getSupabase } from './client'
import { getProductDraftById } from './product-drafts'
import type { ProductDraft } from '../types'

export async function applyChinaWorkOrder(draft: ProductDraft, orderId: string, kind: 'sample' | 'color', action: 'assign' | 'check' | 'ship', assigneeId: string | null = null) {
  const { error } = await getSupabase().rpc('apply_china_work_order', { p_draft: draft.id, p_order: orderId, p_kind: kind, p_action: action, p_assignee: assigneeId, p_revision: draft.updatedAt })
  if (error) { console.warn('[china-work] 지시서 저장 실패', { draftId: draft.id, orderId, error }); throw new Error(error.message) }
  const updated = await getProductDraftById(draft.id)
  if (!updated) throw new Error('저장한 지시서를 다시 조회하지 못했습니다.')
  return updated
}
