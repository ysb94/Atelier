import { getSupabase as releaseClient } from './release-client'
import { fixtureProfile } from './release-auth'
import { koreaDateKey, clockOutLabel } from '@/features/settings/my-attendance'

type Clock = { employee_id: string; work_date: string; clock_in: string; clock_out_at: string | null; clock_out_reported_at: string | null }
type State = { rows: Clock[]; requests: Record<string, unknown>[]; writes: string[]; calls: string[]; saveFailures: number; readError: boolean; basisError: boolean }
const scenario = new URLSearchParams(location.search).get('case') ?? 'missing'
const key = 'atelier:attendance-entry-fixture:' + scenario
function seed(): State {
  const today = koreaDateKey(), previous = scenario === 'weekend' ? '2026-10-30' : '2026-10-26'
  const row = (date: string, out: string | null = null): Clock => ({ employee_id: 'fixture-user', work_date: date, clock_in: '09:00:00', clock_out_at: out, clock_out_reported_at: null })
  const rows = scenario === 'no-previous' ? [] : [row(previous, scenario === 'complete' ? previous + 'T09:00:00Z' : null)]
  if (scenario !== 'missing' && scenario !== 'weekend' && scenario !== 'no-previous') rows.push(row(today))
  const requests: Record<string, unknown>[] = []
  if (scenario === 'pending-correction' || scenario === 'approved-correction' || scenario === 'overtime') requests.push({ id: 'request-1', employee_id: 'fixture-user', employee_name: '검증 직원', department_id: 'other-department', department_name: '일반팀', kind: scenario === 'overtime' ? 'overtime' : 'correction', from_date: previous, to_date: previous, start_time: scenario === 'overtime' ? '18:00:00' : '09:00:00', end_time: scenario === 'overtime' ? '21:00:00' : '18:00:00', note: '검증', place: '', status: scenario === 'pending-correction' ? 'pending' : 'approved', created_at: previous + 'T00:00:00Z', decided_at: null, decided_by_name: null, decision_note: '' })
  return { rows, requests, writes: [], calls: [], saveFailures: scenario === 'save-error' ? 1 : 0, readError: scenario === 'read-error', basisError: scenario === 'basis-error' }
}
function read(): State { const value = localStorage.getItem(key); if (value) return JSON.parse(value); const state = seed(); write(state); return state }
function write(state: State) { localStorage.setItem(key, JSON.stringify(state)) }
Object.assign(window, { __attendanceEntryFixture: { state: read, repairRead: () => { const state = read(); state.readError = false; write(state) } } })

export const isSupabaseConfigured = () => true
export function getSupabase() {
  const base = releaseClient()
  return { ...base, from(table: string) {
    if (table !== 'attendance_clock_ins' && table !== 'company_leave_requests') return base.from(table)
    const filters: Array<(row: Record<string, unknown>) => boolean> = []; let offset = 0, count = 500
    const query = { select() { return query }, order() { return query },
      eq(field: string, value: unknown) { filters.push(row => row[field] === value); return query },
      gte(field: string, value: string) { filters.push(row => String(row[field]) >= value); return query },
      lte(field: string, value: string) { filters.push(row => String(row[field]) <= value); return query },
      range(start: number, end: number) { offset = start; count = end - start + 1; return query }, limit(value: number) { count = value; return query },
      then(resolve: (value: unknown) => unknown) { const state = read(); if (table === 'attendance_clock_ins' && state.readError) return Promise.resolve({ data: null, error: { message: '검증용 기록 조회 실패' } }).then(resolve)
        const rows = (table === 'attendance_clock_ins' ? state.rows : state.requests) as Record<string, unknown>[]
        return Promise.resolve({ data: rows.filter(row => filters.every(filter => filter(row))).slice(offset, offset + count), error: null }).then(resolve) },
    }; return query
  }, rpc(name: string, args: Record<string, unknown> = {}) {
    const state = read(), today = koreaDateKey(), actor = fixtureProfile().id
    if (name === 'get_my_workday_basis') return Promise.resolve(state.basisError ? { data: null, error: { message: '검증용 근무 기준 조회 실패' } } : { data: { date: args.p_date, start_time: scenario === 'unconfigured' ? null : '09:00:00', configured: scenario !== 'unconfigured', lunch_start: '12:00:00', lunch_end: '13:00:00' }, error: null })
    if (name === 'clock_in_today') {
      let current = state.rows.find(row => row.work_date === today && row.employee_id === actor)
      if (!current) { current = { employee_id: actor, work_date: today, clock_in: clockOutLabel(new Date().toISOString()) + ':00', clock_out_at: null, clock_out_reported_at: null }; state.rows.push(current); state.writes.push('clock_in_today') }
      write(state); return Promise.resolve({ data: current.clock_in, error: null })
    }
    if (name === 'confirm_previous_clock_out') {
      state.calls.push(name)
      if (state.saveFailures > 0) { state.saveFailures--; write(state); return Promise.resolve({ data: null, error: { message: '검증용 퇴근 저장 실패' } }) }
      const previous = state.rows.filter(row => row.employee_id === actor && row.work_date < today).sort((a, b) => b.work_date.localeCompare(a.work_date))[0]
      if (!previous || previous.work_date !== args.p_work_date) return Promise.resolve({ data: null, error: { message: '대상 날짜 오류' } })
      const exists = Boolean(previous.clock_out_at)
      if (!exists) { previous.clock_out_at = String(args.p_clock_out_at); previous.clock_out_reported_at = new Date().toISOString(); state.writes.push(name) }
      write(state)
      return Promise.resolve({ data: { work_date: previous.work_date, clock_out_at: previous.clock_out_at, clock_out_reported_at: previous.clock_out_reported_at, outcome: exists ? 'already_recorded' : 'recorded' }, error: null })
    }
    if (name === 'clock_out_today') { const current = state.rows.find(row => row.work_date === today && row.employee_id === actor); if (current && !current.clock_out_at) { current.clock_out_at = new Date(Math.floor(Date.now() / 60000) * 60000).toISOString(); state.writes.push(name); write(state) } return Promise.resolve({ data: current?.clock_out_at, error: null }) }
    if (name === 'undo_clock_out_today') { const current = state.rows.find(row => row.work_date === today && row.employee_id === actor); if (current) current.clock_out_at = null; write(state); return Promise.resolve({ data: null, error: null }) }
    return base.rpc(name, args)
  } }
}
