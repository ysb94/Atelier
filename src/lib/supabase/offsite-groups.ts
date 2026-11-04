import { getSupabase } from './client'
import type { RequestForm } from '@/features/settings/personal-requests'
import { diagnosticQuery } from './diagnostic-query'
import type { DiagnosticContext } from '@/lib/diagnostics/workflow-trace'

export type OffsiteGroup = { id: string; createdBy: string; createdByName: string; createdAt: string; participants: { requestId: string; name: string; state: string }[] }
export async function listOffsiteGroups(): Promise<OffsiteGroup[]> {
  try { return await diagnosticQuery<OffsiteGroup[]>('offsite', 'list_groups', getSupabase().rpc('my_offsite_groups')) ?? [] }
  catch (error) { const code = (error as Error & { cause?: { code?: string } }).cause?.code; throw new Error(['PGRST202','42883'].includes(code ?? '') ? '단체 외근 서버 연결 대기' : '단체 외근을 불러오지 못했습니다.', { cause: error }) }
}
export async function registerOffsiteGroup(id: string, employees: string[], form: RequestForm, context?: DiagnosticContext): Promise<void> {
  try { await diagnosticQuery('offsite', 'register_group', getSupabase().rpc('register_offsite_group', { p_id: id, p_employees: employees, p_form: form }), context) }
  catch (error) { const original = (error as Error & { cause?: { message?: string; details?: string } }).cause; throw new Error([original?.message ?? (error as Error).message, original?.details].filter(Boolean).join(' '), { cause: error }) }
}
export async function setMyOffsiteStart(request: string, start?: string, context?: DiagnosticContext): Promise<void> {
  try { await diagnosticQuery('offsite', 'set_workday_start', getSupabase().rpc('set_my_offsite_start', { p_request: request, p_start: start || null }), context) }
  catch (error) { const original = (error as Error & { cause?: { message?: string; details?: string } }).cause; throw new Error([original?.message ?? (error as Error).message, original?.details].filter(Boolean).join(' '), { cause: error }) }
}
