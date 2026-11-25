import type { InboxNotification } from '@/lib/inbox/types'
import { diagnosticQuery } from './diagnostic-query'
import { getSupabase } from './client'

export const DEPARTURE_HANDOVER_PARAM = 'departureHandover'
export const departureHandoverKey = (actor?: string) => ['departure-handover', actor] as const
export const departureHandoverDetailKey = (actor?: string, employee?: string) => [...departureHandoverKey(actor), 'detail', employee] as const

export type DepartureHandoverNotice = {
  id: string; employeeName: string | null; departmentName: string | null; resignedOn: string
  createdAt: string; version: string; readAt: string | null; pending: number; review: boolean
}
export type DepartureHandoverInbox = { available: boolean; rows: DepartureHandoverNotice[] }

export type DepartureHandoverDetail = Pick<DepartureHandoverNotice,'id'|'employeeName'|'departmentName'|'resignedOn'|'version'|'readAt'> & {
  revision: string
  items: { key: string; kind: 'personal'|'sent'|'approvals'|'requests'|'settings'; owner: string | null; label: string;
    departmentId: string | null; canApply: boolean; suggestedId: string | null }[]
  candidates: { id: string; name: string | null; departmentId: string | null; departmentName: string | null }[]
}

export function departureHandoverNotification(row: DepartureHandoverNotice): InboxNotification {
  const href = `/settings/profile?part=approvals&${DEPARTURE_HANDOVER_PARAM}=${encodeURIComponent(row.id)}`
  return {
    id: `departure-handover:${row.id}`, kind: 'departure_handover', current: row.pending > 0,
    title: `${row.employeeName || '직원'} 님 ${row.review ? '퇴사 인계 후임 확인' : '퇴사 인계 요청'}`,
    body: `${row.departmentName || '소속 미지정'} · ${row.resignedOn} 퇴사 · ${row.pending ? `남은 인계 ${row.pending}건` : '인계 완료'}`,
    href, createdAt: row.createdAt, readAt: row.readAt,
    target: { source: 'departure-handover', entityId: row.id, eventVersion: row.version, tab: 'approvals', href },
    action: row.pending ? { key: `departure-handover:${row.id}`, label: row.review ? '후임 지정 확인 필요' : '인계 처리 필요' } : null,
  }
}

export async function listDepartureHandoverNotices(): Promise<DepartureHandoverInbox> {
  try {
    const rows = await diagnosticQuery<DepartureHandoverNotice[]>('notification','list_departure_handover_notices',
      getSupabase().rpc('list_departure_handover_notices'))
    return { available: true, rows: Array.isArray(rows) ? rows : [] }
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code
    if (code === 'PGRST202' || code === '42883') return { available: false, rows: [] }
    throw new Error('퇴사 인계 알림을 불러오지 못했습니다.', { cause: error })
  }
}

export function getDepartureHandover(id: string) {
  return diagnosticQuery<DepartureHandoverDetail>('notification','get_departure_handover',
    getSupabase().rpc('get_departure_handover', { p_employee: id }))
}

export async function readDepartureHandover(id: string, version: string) {
  const readAt = await diagnosticQuery<string | null>('notification','read_departure_handover',
    getSupabase().rpc('read_departure_handover', { p_employee: id, p_version: version }))
  if (!readAt) throw new Error('최신 인계 내용을 다시 열어 주세요.')
  return readAt
}

export function saveDepartureHandover(id: string, revision: string, choices: Record<string,string>, command: string) {
  return diagnosticQuery<{ applied?: number; recommended?: number; duplicate?: boolean }>('app','save_departure_handover',
    getSupabase().rpc('save_departure_handover', { p_employee: id, p_revision: revision, p_choices: choices, p_command: command }))
}
