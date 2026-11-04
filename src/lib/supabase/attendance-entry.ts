import { getSupabase } from './client'
import { diagnosticOperation, tracedQuery, type DiagnosticContext } from '@/lib/diagnostics/workflow-trace'

export type WorkdayBasis = { date: string; start: string | null; lunchStart: string; lunchEnd: string; configured: boolean; offsiteWorkdayStartSupported?: boolean; startOptions?: string[] }
export type PreviousClockOutResult = { work_date: string; clock_out_at: string | null; clock_out_reported_at: string | null; outcome: 'recorded' | 'already_recorded' | 'correction_pending' | 'corrected' }

export async function getMyWorkdayBasis(date: string, context?: DiagnosticContext): Promise<WorkdayBasis> {
  return diagnosticOperation('leave', 'workday_basis', async trace => {
  const { data, error } = await trace.run('db_request', current => tracedQuery(getSupabase().rpc('get_my_workday_basis', { p_date: date }), current))
  if (error) { trace.fail(error); throw new Error(error.message, { cause: error }) }
  trace.step('parse_basis', { configured: Boolean(data?.configured) })
  return { date: data.date, start: data.start_time?.slice(0, 5) ?? null, lunchStart: data.lunch_start.slice(0, 5), lunchEnd: data.lunch_end.slice(0, 5), configured: data.configured,
    offsiteWorkdayStartSupported: data.offsiteWorkdayStartSupported === true, startOptions: (data.startOptions ?? []).map((start: string) => start.slice(0, 5)) }
  }, context)
}

export async function confirmPreviousClockOut(workDate: string, clockOutAt: string): Promise<PreviousClockOutResult> {
  const { data, error } = await getSupabase().rpc('confirm_previous_clock_out', { p_work_date: workDate, p_clock_out_at: clockOutAt })
  if (error) { console.warn('[attendance-entry] 직전 근무일 퇴근 확인 실패', { workDate, error }); throw new Error(error.message) }
  return data as PreviousClockOutResult
}
