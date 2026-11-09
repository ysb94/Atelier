import { startWorkflow } from '@/lib/diagnostics/workflow-trace'
import type { InboxNotification } from '@/lib/inbox/types'
import { materialNudgeHref } from '@/lib/workspace/material-request-navigation'
import { diagnosticQuery } from './diagnostic-query'
import { getSupabase } from './client'

type NudgeRow = { id: string; sender_name: string; body: string; created_at: string; read_at: string | null; can_open?: boolean }

export const materialNudgeKey = (accountId?: string) => ['material-nudge-notices', accountId] as const

function errorCode(error: unknown) {
  return error instanceof Error ? (error.cause as { code?: string } | undefined)?.code : undefined
}

export function materialNudgeUnavailable(error: unknown) {
  const code = errorCode(error)
  return code === 'PGRST202' || code === '42883'
}

export async function listMyMaterialNudges(signal?: AbortSignal): Promise<InboxNotification[]> {
  let rpc = getSupabase().rpc('list_my_material_nudges')
  if (signal) rpc = rpc.abortSignal(signal)
  const rows = await diagnosticQuery<NudgeRow[]>('notification', 'list_material_nudges', rpc)
  return nudgeNotifications(rows)
}

function nudgeNotifications(rows: NudgeRow[]) {
  return rows.map((row): InboxNotification => ({
    id: row.id, kind: 'material_nudge', title: `${row.sender_name}님의 자재요청 조르기`,
    body: row.body, href: row.can_open ? materialNudgeHref({ scope: 'notice', id: row.id }) : '',
    createdAt: row.created_at, readAt: row.read_at,
  }))
}

export async function getMaterialNudgeInbox(signal?: AbortSignal) {
  let rpc = getSupabase().rpc('material_nudge_workspace', { p_scope: 'inbox' })
  if (signal) rpc = rpc.abortSignal(signal)
  try {
    const result = await diagnosticQuery<{ can_view: boolean; notices: NudgeRow[] }>('notification', 'material_nudge_inbox', rpc)
    return { canView: result?.can_view === true, notifications: nudgeNotifications(result?.notices ?? []) }
  } catch (error) {
    // Keep old notifications available when the new RPC is not installed yet.
    if (!materialNudgeUnavailable(error)) throw error
    return { canView: false, notifications: await listMyMaterialNudges(signal) }
  }
}

export async function sendMaterialNudge(input: { requestId: string; revision: number; recipients: readonly string[]; eventId: string }) {
  const trace = startWorkflow('notification', 'send_material_nudge')
  trace.step('validate_preview')
  if (!input.recipients.length) {
    trace.block('no_recipients')
    throw new Error('조르기 설정에서 받는 사람을 지정해 주세요.')
  }
  try {
    const count = await trace.run('save', context => diagnosticQuery<number>('notification', 'send_material_nudge',
      getSupabase().rpc('send_material_nudge', {
        p_request: input.requestId, p_revision: input.revision, p_recipients: [...input.recipients], p_event: input.eventId,
      }), context))
    trace.done({ writeOutcome: 'committed' })
    return count
  } catch (error) {
    trace.fail(error)
    if (materialNudgeUnavailable(error)) throw new Error('조르기 발송 기능이 아직 서버에 적용되지 않았습니다.')
    if (error instanceof Error && errorCode(error) === '40001') {
      throw new Error('요청 또는 받는 사람이 변경되었습니다. 팝업을 닫고 다시 열어 주세요.', { cause: error.cause })
    }
    if (errorCode(error) === '42501') throw new Error('본인의 자재요청만 조르기 할 수 있습니다.')
    throw new Error('발송을 확인하지 못했습니다. 이 창에서 다시 시도할 수 있습니다.')
  }
}

export async function readMaterialNudge(id: string) {
  const trace = startWorkflow('notification', 'read_material_nudge')
  try {
    await trace.run('save_read', context => diagnosticQuery('notification', 'read_material_nudge',
      getSupabase().rpc('read_material_nudge', { p_id: id }), context))
    trace.done({ writeOutcome: 'committed' })
  } catch (error) {
    trace.fail(error)
    throw error
  }
}
