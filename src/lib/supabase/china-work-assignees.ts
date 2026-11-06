import { DEFAULT_COMPANY_ID } from '@/lib/company/capabilities'
import { startWorkflow } from '@/lib/diagnostics/workflow-trace'
import { diagnosticQuery } from './diagnostic-query'
import { getSupabase } from './client'

/** app.work_department('china')와 같은 중국팀. */
export const CHINA_DEPARTMENT_ID = 'bf926822-910c-422f-9c17-5fd3d8ddb3ba'

export type ChinaWorkAssignee = { profileId: string; sortOrder: number }
type AssigneeRow = { profile_id: string; sort_order: number }

export async function listChinaWorkAssignees(): Promise<ChinaWorkAssignee[]> {
  const rows = await diagnosticQuery<AssigneeRow[] | null>('app', 'china_assignees_read', getSupabase()
    .from('china_work_assignees').select('profile_id, sort_order').eq('company_id', DEFAULT_COMPANY_ID)
    .order('sort_order', { ascending: true }).order('created_at', { ascending: true }).order('profile_id', { ascending: true }))
  return (rows ?? []).map(row => ({ profileId: row.profile_id, sortOrder: row.sort_order }))
}

function savedMessage(error: unknown) {
  const code = typeof error === 'object' && error && 'cause' in error
    ? (error.cause as { code?: string } | null)?.code
    : undefined
  console.warn('[china-assignees] 담당자 목록 저장 실패', { code: code ?? 'unknown' })
  if (code === '23505') return '이미 추가된 담당자입니다.'
  if (code === '23503' && error instanceof Error && /^진행 중 \d+건 · 완료 대기 \d+건이 남아 있습니다\.$/.test(error.message)) return error.message
  if (code === '55P03') return '담당자 업무가 변경 중입니다. 잠시 뒤 다시 시도해 주세요.'
  if (code === '40001') return '담당자 목록이 바뀌었습니다. 새로 불러온 순서를 확인해 주세요.'
  if (code === '42501') return '중국 업무 관리자만 담당자 목록을 바꿀 수 있습니다.'
  return '담당자 목록을 저장하지 못했습니다.'
}

function rethrowSaved(error: unknown): never {
  if (error instanceof Error && !error.cause) throw error
  throw new Error(savedMessage(error))
}

export async function addChinaWorkAssignee(profileId: string) {
  const trace = startWorkflow('app', 'china_assignee_add')
  try {
    trace.step('validate_input')
    if (!profileId) { trace.block('missing_profile'); throw new Error('담당자를 선택해 주세요.') }
    const current = await listChinaWorkAssignees()
    const sortOrder = current.reduce((max, row) => Math.max(max, row.sortOrder), 0) + 1
    await trace.run('save', context => diagnosticQuery('app', 'china_assignee_insert', getSupabase()
      .from('china_work_assignees').insert({ company_id: DEFAULT_COMPANY_ID, profile_id: profileId, sort_order: sortOrder }), context))
    trace.done({ writeOutcome: 'committed' })
  } catch (error) {
    rethrowSaved(error)
  }
}

export async function removeChinaWorkAssignee(profileId: string) {
  const trace = startWorkflow('app', 'china_assignee_remove')
  try {
    trace.step('validate_input')
    if (!profileId) { trace.block('missing_profile'); throw new Error('담당자를 선택해 주세요.') }
    await trace.run('save', context => diagnosticQuery('app', 'china_assignee_delete', getSupabase()
      .from('china_work_assignees').delete().eq('company_id', DEFAULT_COMPANY_ID).eq('profile_id', profileId), context))
    trace.done({ writeOutcome: 'committed' })
  } catch (error) {
    rethrowSaved(error)
  }
}

export async function saveChinaWorkAssigneeOrder(expected: string[], ordered: string[]) {
  const trace = startWorkflow('app', 'china_assignee_move')
  try {
    trace.step('match_displayed_order', { count: expected.length })
    await trace.run('save', context => diagnosticQuery('app', 'china_assignee_order',
      getSupabase().rpc('save_china_work_assignee_order', { p_expected: expected, p_ordered: ordered }), context))
    trace.done({ writeOutcome: 'committed' })
  } catch (error) {
    trace.fail(error)
    rethrowSaved(error)
  }
}
