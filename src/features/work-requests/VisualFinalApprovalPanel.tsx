import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, Textarea } from '@/components/ui/input'
import { isClosedStatus, type WorkRequestRecord } from './work-request-types'
import { visualFinalApprover, visualFinalPending, type VisualFinalAction } from './visual-final-approval'

export function VisualFinalApprovalPanel({ request, activeSupervisorIds, viewerId, canManage, busy, error, memberName, onAction }: {
  request: WorkRequestRecord
  activeSupervisorIds: readonly string[]
  viewerId: string
  canManage: boolean
  busy: boolean
  error?: string
  memberName: (id: string) => string
  onAction: (action: VisualFinalAction, value?: string) => Promise<boolean>
}) {
  const [assignment, setAssignment] = useState<{ id: string; revision?: number } | null>(null)
  const [returnReason, setReturnReason] = useState<string | null>(null)
  const approval = request.visualFinalApproval
  const pending = visualFinalPending(request)
  const closed = isClosedStatus(request.status)
  const approverId = closed ? approval?.approvedBy ?? approval?.approverId : visualFinalApprover(approval, activeSupervisorIds)
  const supervisor = activeSupervisorIds.includes(viewerId)
  const assignedToMe = supervisor && approverId === viewerId
  const canAssign = !closed && (canManage || assignedToMe) && activeSupervisorIds.length > 1
  const canClaim = pending && supervisor && !approverId && !canManage
  const assignmentChanged = assignment !== null && assignment.revision !== request.revision
  const target = assignment && activeSupervisorIds.includes(assignment.id) ? assignment.id : approverId ?? ''
  const needsPanel = Boolean(
    (!closed && !activeSupervisorIds.length)
    || (pending && request.completionResult)
    || approval?.returnedReason
    || canAssign
    || canClaim
    || (pending && assignedToMe)
    || error
  )
  if (!needsPanel) return null

  return <Card role="region" aria-label="총괄 관리자 최종 승인"><CardContent className="space-y-3 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">총괄 관리자 최종 승인</h3>
      {approval?.approvedAt ? <Badge variant="success">최종 승인 완료</Badge>
        : pending ? <Badge variant="warning">총괄 승인 대기</Badge> : null}
    </div>
    <p className="text-sm text-muted-foreground">총괄 관리자 <strong className="text-foreground">{approverId ? memberName(approverId) : '미지정'}</strong></p>
    {!closed && !activeSupervisorIds.length && <p role="status" className="text-sm text-warning">현재 배정 가능한 총괄 관리자가 없습니다. 작업 요청 관리에서 설정을 확인해 주세요.</p>}
    {pending && request.completionResult && <div className="rounded-lg border border-border px-3 py-2 text-sm">
      <p className="font-medium">완료 결과</p><p className="mt-1 whitespace-pre-wrap break-words">{request.completionResult}</p>
    </div>}
    {approval?.returnedReason && <p className="whitespace-pre-wrap break-words text-sm text-danger">최종 승인 반려 사유 · {approval.returnedReason}</p>}
    {canAssign && <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="이 업무의 총괄 관리자" value={target} disabled={busy} onChange={event => setAssignment({ id: event.target.value, revision: request.revision })}>
        <option value="">총괄 관리자 선택</option>
        {activeSupervisorIds.map(id => <option key={id} value={id}>{memberName(id)}</option>)}
      </Select>
      <Button type="button" size="sm" variant="outline" disabled={busy || assignmentChanged || !target || target === approverId} onClick={() => {
        void onAction('assign', target).then(saved => { if (saved) setAssignment(null) })
      }}>총괄 배정 저장</Button>
    </div>}
    {canAssign && assignmentChanged && <p role="status" className="text-sm text-warning">업무가 변경되었습니다. 총괄 관리자를 다시 선택해 주세요.</p>}
    {canClaim && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void onAction('assign', viewerId)}>이 업무 맡기</Button>}
    {pending && assignedToMe && <div className="space-y-2">
      {returnReason === null ? <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={() => void onAction('approve')}>최종 승인</Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setReturnReason('')}>최종 반려</Button>
      </div> : <>
        <Textarea aria-label="최종 반려 사유" value={returnReason} maxLength={1000} rows={3} disabled={busy} onChange={event => setReturnReason(event.target.value)} />
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="danger" disabled={busy || !returnReason.trim()} onClick={() => {
            void onAction('return', returnReason.trim()).then(saved => { if (saved) setReturnReason(null) })
          }}>반려 확정</Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setReturnReason(null)}>취소</Button>
        </div>
      </>}
    </div>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </CardContent></Card>
}
