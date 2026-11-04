import { getSupabase } from './client'
import { diagnosticQuery } from './diagnostic-query'
import { diagnosticOperation, type DiagnosticContext } from '@/lib/diagnostics/workflow-trace'
import type { HolidayWorkList } from '@/features/operations-support/holiday-work'

export type HolidayAction = 'plan' | 'submit' | 'review' | 'cancel' | 'settle' | 'policy' | 'paid'
async function call<T>(action: string, payload: object, context?: DiagnosticContext): Promise<T> {
  return diagnosticQuery<T>('offsite', `holiday_${action}`, getSupabase().rpc('holiday_work', { p_action: action, p_payload: payload }), context)
}
export async function listHolidayWork(month: string, scope: 'mine' | 'review' | 'operations'): Promise<HolidayWorkList> {
  try { return await call<HolidayWorkList>('list', { month: `${month}-01`, scope }) }
  catch (error) {
    const code = (error as Error & { cause?: { code?: string } }).cause?.code
    if (['PGRST202', '42883'].includes(code ?? '')) return { ready: false, rows: [], isOperations: false, policy: null }
    throw error
  }
}
export async function changeHolidayWork(action: HolidayAction, payload: object) {
  return diagnosticOperation('offsite', `holiday_${action}`, async trace => {
    trace.step('validate_input')
    const result = await trace.run('save', context => call<{ id?: string; saved?: boolean }>(action, payload, context))
    trace.done({ writeOutcome: 'committed' })
    return result
  })
}
