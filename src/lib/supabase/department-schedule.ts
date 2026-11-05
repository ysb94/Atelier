import { getSupabase } from './client'
import { diagnosticOperation, tracedQuery } from '@/lib/diagnostics/workflow-trace'
import { DEPARTMENT_ABSENCE_LABELS, departmentScheduleMonth, type DepartmentAbsence, type DepartmentAbsenceKind } from '@/features/settings/department-schedule'

type Row = { request_id: string; employee_id: string; display_name: string | null; kind: string; from_date: string; to_date: string; start_time: string | null; end_time: string | null; end_next_day: boolean | null; offsite_continuous: boolean | null }
export type DepartmentScheduleResult = { ready: boolean; rows: DepartmentAbsence[] }

export function listDepartmentAbsences(month: string): Promise<DepartmentScheduleResult> {
  const window = departmentScheduleMonth(month)
  if (!window) return Promise.reject(new Error('부서 일정의 조회 월을 확인해 주세요.'))
  return diagnosticOperation('leave', 'department_schedule', async trace => {
    const data: Row[] = []
    for (let offset = 0; ; offset += 500) {
      const page = await trace.run('db_request', context => tracedQuery(getSupabase().rpc('list_my_department_absences', { p_from: window.from, p_to: window.to }).range(offset, offset + 499), context))
      if (page.error?.code === 'PGRST202') { trace.block('schema_not_ready'); return { ready: false, rows: [] } }
      if (page.error) { trace.fail(page.error); throw new Error('부서 일정을 불러오지 못했습니다.', { cause: page.error }) }
      data.push(...((page.data ?? []) as Row[]))
      if ((page.data?.length ?? 0) < 500) break
    }
    const rows = data.map((row): DepartmentAbsence => {
      if (!Object.hasOwn(DEPARTMENT_ABSENCE_LABELS, row.kind)) throw new Error('부서 일정의 종류를 확인하지 못했습니다.')
      // Explicit allowlist: never retain a reason, location, file or decision from a response.
      return { id: row.request_id, employeeId: row.employee_id, name: row.display_name?.trim() || '이름 미등록', kind: row.kind as DepartmentAbsenceKind,
        from: row.from_date, to: row.to_date, start: row.start_time?.slice(0, 5) ?? '', end: row.end_time?.slice(0, 5) ?? '', endNextDay: row.end_next_day === true, continuous: row.offsite_continuous === true }
    })
    return { ready: true, rows }
  })
}
