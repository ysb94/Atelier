import type { VisualCommentFile } from '@/lib/supabase/work-request-visual-comments'

export const VISUAL_CATEGORY_STATES = {
  assignment: '작업자 지정 대기',
  working: '작업 중',
  middle_review: '중간 검수 대기',
  supervisor_review: '총괄 검수 대기',
  requester_review: '요청자 결과 확인 대기',
  supervisor_revision: '요청자 수정 의견 전달 대기',
  middle_revision: '작업자에게 수정 전달 대기',
  confirmed: '분류 완료',
} as const

export type VisualCategoryState = keyof typeof VISUAL_CATEGORY_STATES
export type VisualCategoryStep = {
  state: VisualCategoryState
  version: number
  workerId?: string
  resultId?: string
  roundId?: string
}

export type VisualCategoryWorkflow = {
  approverId?: string
  receivedAt?: string
  legacyReceiptPending?: true
  categories: Record<string, VisualCategoryStep>
}

export type VisualWorkflowEntryAction =
  | 'submit' | 'middle_return' | 'supervisor_return' | 'requester_return' | 'supervisor_forward' | 'middle_forward' | 'assign_worker'
  | 'middle_approve' | 'supervisor_approve' | 'requester_confirm'

export type VisualWorkflowAction = VisualWorkflowEntryAction | 'receipt' | 'assign_supervisor'

export type VisualWorkflowEntry = {
  id: string
  action: VisualWorkflowEntryAction
  note: string
  resultUrl: string | null
  roundId?: string | null
  createdAt: string
  sharedAt?: string | null
  assignmentId?: string | null
  actorName?: string | null
  files?: VisualCommentFile[]
}

export type VisualRevisionCounts = { middle?: number; supervisor?: number; requester?: number }

export type VisualWorkflowAssignment = VisualRevisionCounts & {
  id?: string
  workerName?: string | null
  assignedAt?: string
  supervisorRoundId?: string
  supervisorAtStart?: number
  reason?: 'initial' | 'handoff' | 'review' | 'legacy'
}

export type VisualWorkflowReview = {
  role: 'manager' | 'worker' | 'requester'
  result: VisualWorkflowEntry | null
  handoff?: VisualWorkflowEntry | null
  previousMiddleCounts?: number[]
  pastAssignments?: { id?: string | null; middle: number; entries: VisualWorkflowEntry[] }[]
  currentCounts?: VisualRevisionCounts
  reviewRounds?: boolean
  entries: VisualWorkflowEntry[]
  assignments: VisualWorkflowAssignment[]
}

type VisualReviewGroup = {
  openedBy?: VisualWorkflowEntry
  supervisorCount: number
  returns: VisualWorkflowEntry[]
  rounds: Map<number, VisualWorkflowAssignment[]>
}

export function visualReviewGroups(review: VisualWorkflowReview) {
  const first: VisualReviewGroup = { supervisorCount: 0, returns: [], rounds: new Map() }
  const groups = [first]
  const byOpeningId = new Map<string, VisualReviewGroup>()
  let active = first

  for (const entry of [...review.entries].reverse()) {
    if (entry.action === 'supervisor_forward') {
      active = { openedBy: entry, supervisorCount: 0, returns: [], rounds: new Map() }
      groups.push(active)
      byOpeningId.set(entry.id, active)
    } else if (entry.action === 'supervisor_return') {
      active.returns.push(entry)
      active.supervisorCount++
    }
  }

  const newestFirst = [...groups].reverse()
  for (const assignment of review.assignments) {
    const group = assignment.supervisorRoundId && byOpeningId.get(assignment.supervisorRoundId)
    const assignedAt = assignment.assignedAt ? Date.parse(assignment.assignedAt) : undefined
    const legacyGroup = !group && assignedAt && newestFirst.find(item =>
      item.openedBy && Date.parse(item.openedBy.createdAt) <= assignedAt)
    const section = group || legacyGroup || first
    const supervisorAtStart = assignment.supervisorAtStart ?? (assignedAt
      ? section.returns.filter(entry => Date.parse(entry.createdAt) <= assignedAt).length : 0)
    const round = section.rounds.get(supervisorAtStart) ?? []
    round.push(assignment)
    section.rounds.set(supervisorAtStart, round)
    if (section === first) first.supervisorCount = Math.max(first.supervisorCount, assignment.supervisor ?? 0)
  }

  active.supervisorCount = review.currentCounts?.supervisor ?? active.supervisorCount
  for (const group of groups) {
    if (!group.rounds.has(group.supervisorCount)) group.rounds.set(group.supervisorCount, [])
  }
  return groups
}

export function visualHistoryEntries(review: VisualWorkflowReview) {
  const entries = [...review.entries, ...(review.pastAssignments ?? []).flatMap(assignment => assignment.entries)]
  const assigned = new Set(entries.filter(entry => entry.action === 'assign_worker' || entry.action === 'middle_forward')
    .map(entry => entry.assignmentId))
  for (const { id, assignedAt } of review.assignments) {
    if (id && assignedAt && !assigned.has(id)) {
      entries.push({ id: 'assignment:' + id, action: 'assign_worker', note: '', resultUrl: null, createdAt: assignedAt, assignmentId: id })
    }
  }
  return entries.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
}

export type VisualWorkflowNotice = {
  id: string
  requestId: string
  categoryId: string
  categoryLabel: string
  title: string
  kind: 'receipt' | 'registered' | 'rework' | Exclude<VisualCategoryState, 'confirmed'>
  version: number
  personal: boolean
  createdAt: string
  readAt: string | null
  current: boolean
}
