import type { WorkforceMode } from '@/lib/company/workforce-management'
import { diagnosticQuery } from './diagnostic-query'
import type { DiagnosticContext } from '@/lib/diagnostics/workflow-trace'
import { getSupabase } from './client'

export type WorkforcePolicy = { employeeId: string; mode: WorkforceMode; trackingStart: string | null; version: number }
export type WorkforceManagement = { ready: boolean; items: WorkforcePolicy[] }
export type DepartmentWorkforcePolicy = { departmentId: string; mode: Exclude<WorkforceMode, 'logistics'>; trackingStart: string | null; version: number }
export async function listDepartmentWorkforceManagement(): Promise<{ ready: boolean; items: DepartmentWorkforcePolicy[] }> {
  const { data, error } = await getSupabase().rpc('list_department_workforce_management')
  if (error && ['PGRST202', '42883'].includes(error.code)) return { ready: false, items: [] }
  if (error) throw new Error('부서 관리 구분을 불러오지 못했습니다.', { cause: error })
  return { ready: true, items: data ?? [] }
}
export function saveDepartmentWorkforceManagement(input: DepartmentWorkforcePolicy, context?: DiagnosticContext) {
  return diagnosticQuery<DepartmentWorkforcePolicy>('app', 'workforce_policy_save', getSupabase().rpc('save_department_workforce_management', { p_input: input }), context)
}
export async function listWorkforceManagement(): Promise<WorkforceManagement> {
  const { data, error } = await getSupabase().rpc('list_workforce_management')
  if (error && ['PGRST202', '42883'].includes(error.code)) return { ready: false, items: [] }
  if (error) throw new Error('관리 대상 설정을 불러오지 못했습니다.', { cause: error })
  return { ready: true, items: data ?? [] }
}
export function saveWorkforceManagement(input: WorkforcePolicy, context?: DiagnosticContext) {
  return diagnosticQuery<WorkforcePolicy>('app', 'workforce_policy_save', getSupabase().rpc('save_workforce_management', { p_input: input }), context)
}
