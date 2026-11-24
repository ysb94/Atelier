import { startWorkflow } from '@/lib/diagnostics/workflow-trace'
import { getSupabase } from './client'

export type PersonalWorkStatus = 'todo' | 'doing' | 'feedback' | 'done'
export type PersonalWorkAction = 'create' | 'edit' | 'delete' | 'start' | 'pause' | 'submit' | 'complete' | 'approve' | 'revise'
export type PersonalWorkEvent = {
  kind: 'started' | 'resumed' | 'paused' | 'submitted' | 'approved' | 'revision_requested' | 'completed'
  round: number
  at: string
  actor_id: string
  note: string | null
}
export type PersonalWorkCard = {
  id: string
  title: string
  description: string
  status: PersonalWorkStatus
  round: number
  revision: number
  created_at: string
  created_by: string
  creator_name: string
  assignee_id: string
  assignee_name: string
  reviewer_id: string | null
  reviewer_name: string | null
  events: PersonalWorkEvent[]
}
export type PersonalWorkMember = { id: string; name: string; position: string | null }
export type PersonalWorkInput = {
  id: string
  command: string
  action: PersonalWorkAction
  revision?: number
  title?: string
  description?: string
  assignee?: string
  reviewer?: string
  note?: string
}

export function personalWorkUnavailable(error: unknown) {
  return ['PGRST202', '42883'].includes((error as { code?: string } | null)?.code ?? '')
}

export async function listPersonalWorkCards() {
  const { data, error } = await getSupabase().rpc('list_personal_work_cards')
  if (error) throw error
  return data as PersonalWorkCard[]
}

export async function listPersonalWorkMembers() {
  const { data, error } = await getSupabase().rpc('list_personal_work_members')
  if (error) throw error
  return data as PersonalWorkMember[]
}

export async function personalWorkAction(input: PersonalWorkInput) {
  const trace = startWorkflow('app', 'personal_work_action', { kind: input.action })
  await trace.run('save_card', async () => {
    const db = getSupabase()
    const args = {
      p_id: input.id, p_command: input.command, p_revision: input.revision,
      p_reviewer: input.reviewer, p_note: input.note,
    }
    const { error } = input.action === 'submit'
      ? await db.rpc('submit_personal_work_feedback', args)
      : await db.rpc('personal_work_action', {
        ...args, p_action: input.action, p_title: input.title, p_description: input.description, p_assignee: input.assignee,
      })
    if (error) throw error
  })
  trace.done()
}

export function personalWorkErrorMessage(error: unknown) {
  if (personalWorkUnavailable(error)) return '내 업무 서버 연결 대기 중입니다.'
  const { code, message } = (error ?? {}) as { code?: string; message?: string }
  return message && ['42501', '22023', '40001'].includes(code ?? '') && /[가-힣]/.test(message)
    ? message : '업무 처리에 실패했습니다. 다시 시도해 주세요.'
}
