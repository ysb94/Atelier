import { startWorkflow } from '@/lib/diagnostics/workflow-trace'
import type { WorkRequestOwner } from '@/features/work-requests/work-request-form-config'
import { getSupabase } from './client'

export type EmployeeDeparturePreview = {
  version: string
  processedAt: string | null
  resignedOn: string | null
  personalCount: number
  sentCount: number
  requestGroups: { owner: WorkRequestOwner; departmentId: string | null; count: number; settingsCount: number }[]
  approvalCount: number
  canHandoverApprovals: boolean
}

export async function listEmployeeDepartures() {
  const { data, error } = await getSupabase().rpc('list_employee_departures')
  if (error && ['PGRST202', '42883'].includes(error.code)) return []
  if (error) throw error
  return data as { employeeId: string; resignedOn: string }[]
}

export async function previewEmployeeDeparture(employeeId: string) {
  const trace = startWorkflow('app', 'employee_departure_preview')
  const data = await trace.run('check_permissions_and_handover', async () => {
    const { data, error } = await getSupabase().rpc('preview_employee_departure', { p_employee: employeeId })
    if (error) throw error
    return data as EmployeeDeparturePreview
  })
  trace.done()
  return data
}

export async function confirmEmployeeDeparture(input: {
  employeeId: string; resignedOn: string; handoverOnly: boolean; workSuccessor: string | null; approvalSuccessor: string | null; version: string; command: string
  requestSuccessors: Partial<Record<WorkRequestOwner, string>>
}) {
  const trace = startWorkflow('app', input.handoverOnly ? 'employee_departure_handover' : 'employee_departure_confirm')
  await trace.run(input.handoverOnly ? 'transfer_remaining_work' : 'save_departure_and_revoke_sessions', async () => {
    const rpc = {
      p_employee: input.employeeId, p_work_successor: input.workSuccessor,
      p_approval_successor: input.approvalSuccessor, p_version: input.version, p_command: input.command,
      p_request_successors: input.requestSuccessors,
    }
    const db = getSupabase()
    const { error } = input.handoverOnly ? await db.rpc('handover_departed_employee_work', rpc)
      : await db.rpc('confirm_employee_departure', { ...rpc, p_resigned_on: input.resignedOn })
    if (error) throw error
  })
  trace.done()
}

export function employeeDepartureError(error: unknown) {
  const { code, message } = (error ?? {}) as { code?: string; message?: string }
  if (['PGRST202', '42883'].includes(code ?? '')) return '퇴사 처리 서버 연결 대기 중입니다.'
  if (message && ['42501', '40001', '22023'].includes(code ?? '') && /^[가-힣]/.test(message)) return message
  return '퇴사 처리 결과를 확인할 수 없습니다. 다시 조회해 주세요.'
}
