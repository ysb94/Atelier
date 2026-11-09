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
  requesterFeedback?: VisualWorkflowEntry
  supervisorCount: number
  assignments: { assignment: VisualWorkflowAssignment; index: number; entries: VisualWorkflowEntry[] }[]
}

export function visualReviewGroups(review: VisualWorkflowReview) {
  const first: VisualReviewGroup = { supervisorCount: 0, assignments: [] }
  const groups = [first]
  const byOpeningId = new Map<string, VisualReviewGroup>()
  const entriesByAssignment = new Map<string, VisualWorkflowEntry[]>()
  const requesterFeedback = new Map<string, VisualWorkflowEntry>()
  let active = first

  for (const entry of [...review.entries].reverse()) {
    if (entry.action === 'requester_return') requesterFeedback.set(entry.id, entry)
    if (entry.action === 'supervisor_forward') {
      active = {
        openedBy: entry, requesterFeedback: entry.roundId ? requesterFeedback.get(entry.roundId) : undefined,
        supervisorCount: 0, assignments: [],
      }
      groups.push(active)
      byOpeningId.set(entry.id, active)
    } else if (entry.action === 'supervisor_return') {
      active.supervisorCount++
    }
  }

  for (const entry of review.entries) {
    if (!entry.assignmentId || entry.action === 'supervisor_forward') continue
    const items = entriesByAssignment.get(entry.assignmentId) ?? []
    items.push(entry)
    entriesByAssignment.set(entry.assignmentId, items)
  }
  const newestFirst = [...groups].reverse()
  for (const [index, assignment] of review.assignments.entries()) {
    const group = assignment.supervisorRoundId && byOpeningId.get(assignment.supervisorRoundId)
    const assignedAt = assignment.assignedAt
    const legacyGroup = !group && assignedAt && newestFirst.find(item =>
      item.openedBy && Date.parse(item.openedBy.createdAt) <= Date.parse(assignedAt))
    const section = group || legacyGroup || first
    section.assignments.push({ assignment, index, entries: assignment.id ? entriesByAssignment.get(assignment.id) ?? [] : [] })
    if (section === first) first.supervisorCount = Math.max(first.supervisorCount, assignment.supervisor ?? 0)
  }

  active.supervisorCount = review.currentCounts?.supervisor ?? active.supervisorCount
  return { groups, requesterCount: requesterFeedback.size }
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
