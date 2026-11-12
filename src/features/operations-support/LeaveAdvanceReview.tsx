import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/input'
import { isAllDayRequest, requestLabel, requestedLeaveDays, requestStatusLabel } from '@/features/settings/personal-requests'
import { useReadMyHomeNotification } from '@/features/settings/use-my-home-notifications'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { formatNumber } from '@/lib/utils'
import { LeaveAdvanceDrawer } from './LeaveAdvanceDrawer'
import { useLeaveRequests } from './use-leave-requests'

const STATUS_TONE = { pending: 'warning', approved: 'success', rejected: 'danger', cancelled: 'muted' } as const

export function LeaveAdvanceReview({ requestId, approvalReady, onClose }: {
  requestId: string
  approvalReady: boolean
  onClose: () => void
}) {
  const leave = useLeaveRequests('advances')
  const preview = usePagePreview()
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const request = leave.requests.find(item => item.id === requestId && item.advanceRequested)
  const visible = Boolean(request && !leave.error && !leave.loading)
  const selfRequest = request?.employeeId === leave.userId
  const canDecide = visible && approvalReady && request?.status === 'pending' && !selfRequest && !preview?.active
  const notice = useReadMyHomeNotification('request', request?.id, `request-approval:${requestId}`, visible && approvalReady)
  const days = request ? requestedLeaveDays(request) : null

  async function decide(status: 'approved' | 'rejected') {
    if (!request || !canDecide || leave.busy) return
    if (status === 'rejected' && !note.trim()) {
      setError('반려 사유를 입력해 주세요.')
      return
    }
    setError('')
    try {
      await leave.transition.mutateAsync({ id: request.id, status, note })
      setNote('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '선사용 요청을 처리하지 못했습니다.')
    }
  }

  return <LeaveAdvanceDrawer title={visible && request ? `${request.employeeName} 연차 선사용 상세` : '연차 선사용 상세'}
    department={visible ? request?.departmentName : undefined} busy={leave.busy} onClose={onClose}>
    {leave.loading ? <p role="status" className="text-sm text-muted-foreground">선사용 요청을 불러오는 중입니다.</p>
      : leave.error ? <p role="alert" className="text-sm text-danger">선사용 요청을 불러오지 못했습니다. <Button type="button" size="sm" variant="outline" onClick={() => void leave.refresh()}>다시 조회</Button></p>
      : !request ? <p role="status" className="text-sm text-muted-foreground">열 수 있는 선사용 요청이 없습니다.</p>
      : <>
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{requestLabel(request.kind)} 선사용</h3>
            <Badge variant={STATUS_TONE[request.status]}>{requestStatusLabel(request)}</Badge>
          </div>
          <dl className="space-y-2 text-sm">
            <div><dt className="text-muted-foreground">휴가 일정</dt><dd className="tabular-nums">{request.from}{request.from !== request.to && ` ~ ${request.to}`}{!isAllDayRequest(request.kind) && ` · ${request.start}–${request.end}`}</dd></div>
            {days !== null && <div><dt className="text-muted-foreground">신청 일수</dt><dd className="tabular-nums">{formatNumber(days)}일</dd></div>}
          </dl>
        </Card>
        <section aria-label="선사용 사유" className="space-y-2">
          <h3 className="text-sm font-semibold">선사용 사유</h3>
          <p className="whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/40 p-3 text-sm">{request.note || '등록된 사유가 없습니다.'}</p>
        </section>
        {notice.error && <p role="alert" className="text-sm text-danger">{notice.error} <Button type="button" size="sm" variant="outline" onClick={notice.retry}>읽음 저장 재시도</Button></p>}
        {canDecide && <>
          <label className="block text-sm">처리 의견 <span className="text-muted-foreground">· 반려 시 필수</span>
            <Textarea aria-label="선사용 처리 의견" maxLength={2000} rows={2} value={note} disabled={leave.busy} onChange={event => setNote(event.target.value)} className="mt-2"/>
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={leave.busy} onClick={() => void decide('rejected')}>반려</Button>
            <Button type="button" disabled={leave.busy} onClick={() => void decide('approved')}>{leave.busy ? '처리 중…' : '승인'}</Button>
          </div>
        </>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {request.status === 'pending' && !canDecide && <p role="status" className="text-sm text-muted-foreground">{selfRequest ? '본인 요청은 다른 운영지원 담당자가 처리합니다.' : '운영지원 승인 설정을 확인해 주세요.'}</p>}
        {request.status === 'approved' && <p role="status" className="text-sm text-success">승인되어 직원의 달력에 휴가가 등록됐습니다.</p>}
        {request.decidedAt && <p className="text-xs text-muted-foreground">{request.decidedByName} · {new Date(request.decidedAt).toLocaleString('ko-KR')}</p>}
        {request.decisionNote && <p className="whitespace-pre-wrap break-words text-sm">{request.decisionNote}</p>}
      </>}
  </LeaveAdvanceDrawer>
}
