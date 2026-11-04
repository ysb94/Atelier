import { getSupabase } from './client'
import type { RequestForm } from '@/features/settings/personal-requests'

export type OffsiteGroup = { id: string; createdBy: string; createdByName: string; createdAt: string; participants: { requestId: string; name: string; state: string }[] }
export async function listOffsiteGroups(): Promise<OffsiteGroup[]> {
  const { data, error } = await getSupabase().rpc('my_offsite_groups')
  if (error) { console.warn('[offsite-groups] 단체 외근 조회 실패', error); throw new Error(['PGRST202','42883'].includes(error.code) ? '단체 외근 서버 연결 대기' : '단체 외근을 불러오지 못했습니다.') }
  return data ?? []
}
export async function registerOffsiteGroup(id: string, employees: string[], form: RequestForm): Promise<void> {
  const { error } = await getSupabase().rpc('register_offsite_group', { p_id: id, p_employees: employees, p_form: form })
  if (error) { console.warn('[offsite-groups] 단체 등록 실패', error); throw new Error([error.message, error.details].filter(Boolean).join(' ')) }
}
export async function setMyOffsiteStart(request: string, start?: string): Promise<void> {
  const { error } = await getSupabase().rpc('set_my_offsite_start', { p_request: request, p_start: start || null })
  if (error) { console.warn('[offsite-groups] 출근 기준 변경 실패', error); throw new Error([error.message, error.details].filter(Boolean).join(' ')) }
}
