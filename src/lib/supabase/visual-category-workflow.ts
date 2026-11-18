import type { VisualWorkflowAction, VisualWorkflowNotice, VisualWorkflowReview } from '@/features/work-requests/visual-category-workflow'
import type { DiagnosticContext } from '@/lib/diagnostics/workflow-trace'
import { diagnosticQuery } from './diagnostic-query'
import { getSupabase } from './client'

type ActionInput = {
  request: string
  category: string
  revision: number
  action: VisualWorkflowAction
  person: string | null
  note: string
  resultUrl: string
  command: string
}

export function changeVisualCategoryWork(input: ActionInput, context: DiagnosticContext) {
  return diagnosticQuery<number>('app', 'visual_category_work_change', getSupabase().rpc('change_visual_category_work', {
    p_request: input.request, p_category: input.category, p_revision: input.revision, p_action: input.action,
    p_person: input.person, p_note: input.note, p_result_url: input.resultUrl, p_command: input.command,
  }), context)
}

export function getVisualWorkflowReview(request: string, category: string) {
  return diagnosticQuery<VisualWorkflowReview>('app', 'visual_category_work_history', getSupabase().rpc('get_visual_workflow_review', {
    p_request: request, p_category: category,
  }))
}

export async function listMyVisualWorkflowNotices(): Promise<{ available: boolean; rows: VisualWorkflowNotice[] }> {
  const missing = (error: unknown) => {
    const code = (error as Error & { cause?: { code?: string } }).cause?.code
    return code === 'PGRST202' || code === '42883'
  }
  const list = (name: string) => diagnosticQuery<VisualWorkflowNotice[]>('notification', 'visual_category_notice_list', getSupabase().rpc(name))
  try {
    return { available: true, rows: await list('list_my_visual_workflow_notices_with_content') }
  } catch (error) {
    if (!missing(error)) throw error
  }
  try {
    return { available: true, rows: await list('list_my_visual_workflow_notices') }
  } catch (error) {
    if (missing(error)) return { available: false, rows: [] }
    throw error
  }
}

export function readVisualWorkflowNotices(request: string, category: string, revision: number, ids: string[], context: DiagnosticContext) {
  return diagnosticQuery('notification', 'visual_category_notice_read', getSupabase().rpc('read_my_visual_workflow_notices', {
    p_request: request, p_category: category, p_revision: revision, p_ids: ids,
  }), context)
}
