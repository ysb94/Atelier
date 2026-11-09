import type { VisualWorkflowAction, VisualWorkflowEntry, VisualWorkflowNotice } from '@/features/work-requests/visual-category-workflow'
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

export function listVisualWorkflowEntries(request: string, category: string) {
  return diagnosticQuery<VisualWorkflowEntry[]>('app', 'visual_category_work_history', getSupabase().rpc('list_visual_workflow_entries', {
    p_request: request, p_category: category,
  }))
}

export async function listMyVisualWorkflowNotices(): Promise<{ available: boolean; rows: VisualWorkflowNotice[] }> {
  try {
    const rows = await diagnosticQuery<VisualWorkflowNotice[]>('notification', 'visual_category_notice_list', getSupabase().rpc('list_my_visual_workflow_notices'))
    return { available: true, rows }
  } catch (error) {
    const code = (error as Error & { cause?: { code?: string } }).cause?.code
    if (code === 'PGRST202' || code === '42883') return { available: false, rows: [] }
    throw error
  }
}

export function readVisualWorkflowNotices(request: string, category: string, revision: number, ids: string[], context: DiagnosticContext) {
  return diagnosticQuery('notification', 'visual_category_notice_read', getSupabase().rpc('read_my_visual_workflow_notices', {
    p_request: request, p_category: category, p_revision: revision, p_ids: ids,
  }), context)
}
