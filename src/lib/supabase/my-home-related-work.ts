import type { WorkRequestOwner } from '@/features/work-requests/work-request-form-config'
import type { RequestStatus } from '@/features/work-requests/work-request-types'
import { diagnosticQuery } from './diagnostic-query'
import { getSupabase } from './client'
import { personalWorkOwner, type PersonalWorkCard, type PersonalWorkStatus } from './personal-work'

export type RelatedWorkView = 'feedback' | 'issued'
export type RelatedWorkTarget = { categoryId: string; label: string; kind: string; version: number }
export type RelatedWorkItem = {
  key: string; source: 'personal' | 'department'; id: string; owner: WorkRequestOwner | null
  title: string; requesterName: string; assigneeNames: string[]; status: PersonalWorkStatus | RequestStatus
  activityAt: string; round: number | null; noticeId: string | null; targets: RelatedWorkTarget[]
  isRequester?: boolean; internal?: boolean; finalApprovalPending?: boolean
}
export type RelatedWorkCursor = { at: string; key: string }
export type RelatedWorkPage = { available: boolean; items: RelatedWorkItem[]; total: number; nextCursor: RelatedWorkCursor | null }
export const relatedWorkKey = (actor?: string) => ['my-home-related-work', actor] as const

export async function listMyHomeRelatedWork(view: RelatedWorkView, cursor: RelatedWorkCursor | null, signal: AbortSignal): Promise<RelatedWorkPage> {
  try {
    const page = await diagnosticQuery<Omit<RelatedWorkPage, 'available'>>('app', 'list_my_home_related_work',
      getSupabase().rpc('list_my_home_related_work', {
        p_view: view, p_before_at: cursor?.at ?? null, p_before_key: cursor?.key ?? null,
      }).abortSignal(signal))
    return { ...page, available: true }
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code
    if (code === 'PGRST202' || code === '42883') {
      console.warn('[my-home-related-work] 통합 업무 조회 서버 연결 대기', { code })
      return { available: false, items: [], total: 0, nextCursor: null }
    }
    throw error
  }
}

/** Older servers still show the personal cards already authorized by their existing RPC. */
export function personalRelatedWork(cards: readonly PersonalWorkCard[], actor: string | undefined, view: RelatedWorkView): RelatedWorkItem[] {
  if (!actor) return []
  return cards.filter(card => view === 'feedback'
    ? card.reviewer_id === actor && card.status === 'feedback'
    : personalWorkOwner(card) === actor && card.assignee_id !== actor)
    .map(card => ({
      key: `personal:${card.id}`, source: 'personal' as const, id: card.id, owner: null,
      title: card.title, requesterName: card.owner_name ?? card.creator_name, assigneeNames: [card.assignee_name],
      status: card.status, activityAt: card.events.at(-1)?.at ?? card.created_at, round: card.round,
      noticeId: null, targets: [],
    })).sort((a, b) => b.activityAt.localeCompare(a.activityAt) || b.key.localeCompare(a.key))
}
