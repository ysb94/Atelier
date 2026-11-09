import { isClosedStatus, STATUS_META, type RequestStatus, type WorkRequestRecord } from './work-request-types'

export type VisualFinalApproval = {
  approverId?: string | null
  requestedAt?: string
  approvedAt?: string
  approvedBy?: string
  returnedAt?: string
  returnedBy?: string
  returnedReason?: string
}

export type VisualFinalAction = 'assign' | 'submit' | 'approve' | 'return'

export function visualFinalPending(work: { status: RequestStatus; visualFinalApproval?: VisualFinalApproval | null }) {
  return work.status === 'completionConfirm' && Boolean(work.visualFinalApproval?.requestedAt)
}

export function visualFinalApprover(approval: VisualFinalApproval | null | undefined, activeSupervisorIds: readonly string[]) {
  const assigned = approval?.approverId
  if (assigned && activeSupervisorIds.includes(assigned)) return assigned
  return activeSupervisorIds.length === 1 ? activeSupervisorIds[0] : undefined
}

export function visualSummaryApprover(work: Pick<WorkRequestRecord, 'status' | 'visualFinalApproval' | 'visualCategoryWorkflow'>
  & { visualCategoryReview?: Pick<VisualFinalApproval, 'approverId'> | null }, activeSupervisorIds: readonly string[]) {
  const categoryWorkflow = work.visualCategoryWorkflow ?? work.visualCategoryReview
  if (categoryWorkflow) return isClosedStatus(work.status) ? categoryWorkflow.approverId ?? undefined : visualFinalApprover(categoryWorkflow, activeSupervisorIds)
  return isClosedStatus(work.status)
    ? work.visualFinalApproval?.approvedBy ?? work.visualFinalApproval?.approverId ?? undefined
    : visualFinalApprover(work.visualFinalApproval, activeSupervisorIds)
}

export function workRequestStatusMeta(work: Pick<WorkRequestRecord, 'status' | 'visualFinalApproval'>) {
  return visualFinalPending(work) ? { label: '총괄 승인 대기', variant: 'warning' as const } : STATUS_META[work.status]
}
