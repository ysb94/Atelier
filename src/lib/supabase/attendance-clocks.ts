import { getSupabase } from './client'
import { diagnosticOperation, tracedQuery, type DiagnosticContext } from '@/lib/diagnostics/workflow-trace'
import { fetchAttendancePages } from './attendance-pagination'
import { attendanceMonthDates, type AttendanceClock } from '@/features/settings/my-attendance'

type ClockRow = { work_date: string; clock_in: string; clock_out_at: string | null; clock_out_reported_at: string | null; auto_closed_at: string | null; work_confirmed_at: string | null }
type EffectiveClockRow = ClockRow & { employee_id: string; clock_in_source?: string; clock_out_source?: string }
const missingEffectiveRpc = (error: { code?: string } | null) => error?.code === 'PGRST202'
export type CompanyAttendanceClock = { employeeId: string; date: string; clockIn: string }
export async function listMyAttendanceClocks(employeeId: string, month?: string): Promise<AttendanceClock[]> {
  if (!employeeId) throw new Error('로그인 상태를 확인해 주세요.')
  const dates = month ? attendanceMonthDates(month) : null
  let effective = getSupabase().rpc('list_effective_attendance_clocks', {
    p_from: dates?.[0] ?? '1900-01-01', p_to: dates?.[dates.length - 1] ?? '9999-12-31', p_employee_id: employeeId,
  }).order('work_date', { ascending: false })
  if (!month) effective = effective.limit(400)
  const result = await effective
  if (!result.error) return ((result.data ?? []) as EffectiveClockRow[]).map(row => ({ date: row.work_date, clockIn: row.clock_in.slice(0, 5), clockOutAt: row.clock_out_at, clockOutReportedAt: row.clock_out_reported_at ?? null, autoClosedAt: row.auto_closed_at, workConfirmedAt: row.work_confirmed_at, clockInSource: row.clock_in_source ?? null, clockOutSource: row.clock_out_source ?? null }))
  if (!missingEffectiveRpc(result.error)) { console.warn('[attendance-clock] 유효 출퇴근 조회 실패', { month, error: result.error }); throw new Error(result.error.message) }
  console.warn('[attendance-clock] 외근 출퇴근 연결 대기: 기존 기록을 표시합니다.', { month })
  let query = getSupabase().from('attendance_clock_ins').select('work_date,clock_in,clock_out_at,clock_out_reported_at,auto_closed_at,work_confirmed_at')
    .eq('employee_id', employeeId).order('work_date', { ascending: false })
  if (month) {
    const dates = attendanceMonthDates(month)
    query = query.gte('work_date', dates[0]).lte('work_date', dates[dates.length - 1])
  } else query = query.limit(400)
  const { data, error } = await query
  if (error) { console.warn('[attendance-clock] 내 출퇴근 기록 조회 실패', { month, error }); throw new Error(error.message) }
  return ((data ?? []) as ClockRow[]).map(row => ({ date: row.work_date, clockIn: row.clock_in.slice(0, 5), clockOutAt: row.clock_out_at, clockOutReportedAt: row.clock_out_reported_at ?? null, autoClosedAt: row.auto_closed_at, workConfirmedAt: row.work_confirmed_at }))
}
export type CompanyDeferredClockOut = { employeeId: string; date: string; clockIn: string; clockOutAt: string | null; reportedAt: string | null; autoClosedAt?: string | null; workConfirmedAt?: string | null }
type DeferredClockRow = ClockRow & { employee_id: string }
export async function listCompanyDeferredClockOuts(): Promise<CompanyDeferredClockOut[]> {
  const { data, error } = await getSupabase().from('attendance_clock_ins')
    .select('employee_id,work_date,clock_in,clock_out_at,clock_out_reported_at,auto_closed_at,work_confirmed_at')
    .or('clock_out_reported_at.not.is.null,auto_closed_at.not.is.null')
    .order('work_date', { ascending: false })
  if (error) { console.warn('[attendance-clock] 퇴근 미처리 조회 실패', error); throw new Error(error.message) }
  return ((data ?? []) as DeferredClockRow[]).flatMap(row => row.clock_out_reported_at || row.auto_closed_at ? [{
    employeeId: row.employee_id, date: row.work_date, clockIn: row.clock_in.slice(0, 5), clockOutAt: row.clock_out_at, reportedAt: row.clock_out_reported_at,
    autoClosedAt: row.auto_closed_at, workConfirmedAt: row.work_confirmed_at,
  }] : [])
}
export type CompanyAttendanceSpan = { employeeId: string; date: string; clockIn: string; clockOutAt: string | null }
type SpanRow = { employee_id: string; work_date: string; clock_in: string; clock_out_at: string | null }
export async function listCompanyAttendanceSpans(month: string): Promise<CompanyAttendanceSpan[]> {
  const dates = attendanceMonthDates(month)
  const effective = await fetchAttendancePages<EffectiveClockRow>(async (from, to) => {
    const result = await getSupabase().rpc('list_effective_attendance_clocks', { p_from: dates[0], p_to: dates[dates.length - 1], p_employee_id: null })
      .order('work_date', { ascending: false }).order('employee_id').range(from, to)
    return { data: result.data as EffectiveClockRow[] | null, error: result.error }
  })
  if (!effective.error) return effective.rows.map(row => ({ employeeId: row.employee_id, date: row.work_date, clockIn: row.clock_in.slice(0, 5), clockOutAt: row.clock_out_at }))
  if (!missingEffectiveRpc(effective.error)) { console.warn('[attendance-clock] 유효 회사 근무시간 조회 실패', { month, error: effective.error }); throw new Error(effective.error.message) }
  console.warn('[attendance-clock] 외근 출퇴근 연결 대기: 기존 회사 기록을 표시합니다.', { month })
  const fallback = await fetchAttendancePages<SpanRow>(async (from, to) => {
    const result = await getSupabase().from('attendance_clock_ins').select('employee_id,work_date,clock_in,clock_out_at')
      .gte('work_date', dates[0]).lte('work_date', dates[dates.length - 1]).order('work_date', { ascending: false }).order('employee_id').range(from, to)
    return { data: result.data as SpanRow[] | null, error: result.error }
  })
  if (fallback.error) { console.warn('[attendance-clock] 회사 근무시간 조회 실패', { month, error: fallback.error }); throw new Error(fallback.error.message) }
  return fallback.rows.map(row => ({ employeeId: row.employee_id, date: row.work_date, clockIn: row.clock_in.slice(0, 5), clockOutAt: row.clock_out_at }))
}
export async function listEmployeeAttendanceClocks(employeeId: string, from: string, to: string): Promise<CompanyAttendanceClock[]> {
  const effective = await getSupabase().rpc('list_effective_attendance_clocks', { p_from: from, p_to: to, p_employee_id: employeeId }).order('work_date')
  if (!effective.error) return ((effective.data ?? []) as EffectiveClockRow[]).map(row => ({ employeeId: row.employee_id, date: row.work_date, clockIn: row.clock_in.slice(0, 5) }))
  if (!missingEffectiveRpc(effective.error)) { console.warn('[attendance-clock] 기간 출퇴근 조회 실패', { from, to, error: effective.error }); throw new Error(effective.error.message) }
  console.warn('[attendance-clock] 외근 출퇴근 연결 대기: 기존 기록을 표시합니다.', { from, to })
  const { data, error } = await getSupabase().from('attendance_clock_ins').select('employee_id,work_date,clock_in')
    .eq('employee_id', employeeId).gte('work_date', from).lte('work_date', to).order('work_date')
  if (error) { console.warn('[attendance-clock] 기간 출퇴근 조회 실패', { from, to, error }); throw new Error(error.message) }
  return ((data ?? []) as { employee_id: string; work_date: string; clock_in: string }[]).map(row => ({ employeeId: row.employee_id, date: row.work_date, clockIn: row.clock_in.slice(0, 5) }))
}
export async function listCompanyAttendanceClocks(month: string): Promise<CompanyAttendanceClock[]> {
  return (await listCompanyAttendanceSpans(month)).map(({ employeeId, date, clockIn }) => ({ employeeId, date, clockIn }))
}
export async function clockOutToday(context?: DiagnosticContext): Promise<string> {
  return diagnosticOperation('leave', 'checkout_overtime', async trace => {
    const { data, error } = await trace.run('save_checkout', context => tracedQuery(getSupabase().rpc('clock_out_today'), context))
    if (error) { trace.fail(error); throw new Error(error.message) }
    trace.step('checkout_saved', { writeOutcome: 'committed' })
    return String(data)
  }, context)
}
export async function undoClockOutToday(context?: DiagnosticContext): Promise<void> {
  return diagnosticOperation('leave', 'undo_checkout', async trace => {
    const { error } = await trace.run('save_undo', current => tracedQuery(getSupabase().rpc('undo_clock_out_today'), current))
    if (error) { trace.fail(error); throw new Error(error.message) }
  }, context)
}
