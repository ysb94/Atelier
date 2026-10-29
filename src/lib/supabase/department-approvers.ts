import { getSupabase } from './client'
import { DEFAULT_COMPANY_ID } from './brands'

export type ApprovalType = 'leave' | 'overtime'
export { assignedDepartmentIds } from '@/lib/company/attendance-assignment'
export type DepartmentApprover = {
  departmentId: string; type: ApprovalType; approverId: string | null; substituteId: string | null
  updatedAt: string
}
type Row = { department_id: string; request_type: ApprovalType; approver_id: string | null; substitute_id: string | null; updated_at: string }
export async function listDepartmentApprovers(): Promise<DepartmentApprover[]> {
  const rows: DepartmentApprover[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await getSupabase().from('department_request_approvers')
      .select('department_id,request_type,approver_id,substitute_id,updated_at').order('department_id').order('request_type').range(offset, offset + 499)
    if (error) { console.warn('[department-approvers] 승인자 조회 실패', error); throw new Error(error.message) }
    rows.push(...(data as Row[]).map(row => ({ departmentId: row.department_id, type: row.request_type,
      approverId: row.approver_id, substituteId: row.substitute_id, updatedAt: row.updated_at })))
    if (data.length < 500) return rows
  }
}
export async function saveDepartmentApprovers(departmentId: string, settings: { type: ApprovalType; approverId: string | null; substituteId: string | null }[]): Promise<void> {
  const { error } = await getSupabase().from('department_request_approvers').upsert(settings.map(setting => ({
    company_id: DEFAULT_COMPANY_ID, department_id: departmentId, request_type: setting.type,
    approver_id: setting.approverId, substitute_id: setting.substituteId,
  })), { onConflict: 'company_id,department_id,request_type' })
  if (error) { console.warn('[department-approvers] 승인자 저장 실패', error); throw new Error(error.message) }
}
