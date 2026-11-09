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

export type VisualWorkflowAction = VisualWorkflowEntryAction
  | 'receipt' | 'assign_supervisor' | 'middle_approve' | 'supervisor_approve' | 'requester_confirm'

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
}

export type VisualWorkflowAssignment = {
  id?: string
  workerName?: string | null
  assignedAt?: string
  reason?: 'initial' | 'handoff' | 'review' | 'legacy'
  middle?: number
  supervisor?: number
  requester?: number
}

export type VisualWorkflowReview = {
  role: 'manager' | 'worker' | 'requester'
  result: VisualWorkflowEntry | null
  handoff?: VisualWorkflowEntry | null
  entries: VisualWorkflowEntry[]
  assignments: VisualWorkflowAssignment[]
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
