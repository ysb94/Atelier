import { DEFAULT_COMPANY_ID } from '@/lib/company/capabilities'
import { startWorkflow } from '@/lib/diagnostics/workflow-trace'
import { diagnosticQuery } from './diagnostic-query'
import { getSupabase } from './client'

export async function listMaterialNudgeRecipients(): Promise<string[]> {
  const rows = await diagnosticQuery<{ profile_id: string }[] | null>('app', 'material_nudge_recipients_read', getSupabase()
    .from('material_nudge_recipients').select('profile_id').eq('company_id', DEFAULT_COMPANY_ID).order('created_at', { ascending: true }))
  return (rows ?? []).map(row => row.profile_id)
}

function savedMessage(error: unknown) {
  const code = typeof error === 'object' && error && 'cause' in error
    ? (error.cause as { code?: string } | null)?.code
    : undefined
  console.warn('[material-nudge] 조르기 대상 저장 실패', { code: code ?? 'unknown' })
  if (code === '40001') return '다른 직원이 조르기 수신자 설정을 변경했습니다.'
  if (code === '55P03') return '다른 직원이 조르기 수신자 설정을 저장 중입니다. 잠시 뒤 다시 시도해 주세요.'
  if (code === 'PGRST202' || code === '42883') return '조르기 설정 저장 기능이 아직 서버에 적용되지 않았습니다.'
  if (error instanceof Error && error.message.includes('10명')) return error.message
  if (code === '42501') return '기획 업무 권한이 있어야 조르기 대상을 바꿀 수 있습니다.'
  if (code === '22023') return '알림 받을 사람을 다시 확인해 주세요.'
  return '조르기 대상을 저장하지 못했습니다.'
}

export async function saveMaterialNudgeRecipients(profileIds: readonly string[], expectedIds: readonly string[]) {
  const trace = startWorkflow('app', 'material_nudge_recipients_save')
  try {
    trace.step('validate_input')
    if (profileIds.length > 10) {
      trace.block('too_many')
      throw new Error('알림 받을 사람은 10명까지 지정할 수 있습니다.')
    }
    await trace.run('save', context => diagnosticQuery('app', 'material_nudge_recipients_save', getSupabase()
      .rpc('save_material_nudge_recipients_checked', { p_ids: [...profileIds], p_expected_ids: [...expectedIds] }), context))
    trace.done({ writeOutcome: 'committed' })
  } catch (error) {
    if (error instanceof Error && !error.cause) throw error
    throw new Error(savedMessage(error), { cause: error instanceof Error ? error.cause : error })
  }
}
