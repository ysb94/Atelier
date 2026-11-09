import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { Input, Select, Textarea } from '@/components/ui/input'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { useAuth } from '@/lib/supabase/auth'
import { diagnosticOperation } from '@/lib/diagnostics/workflow-trace'
import { sharedReadPolicy } from '@/lib/query/shared-read-policy'
import { changeVisualCategoryWork, getVisualWorkflowReview } from '@/lib/supabase/visual-category-workflow'
import { VisualWorkflowHistory } from './VisualWorkflowHistory'
import { visualFinalApprover } from './visual-final-approval'
import { useReadVisualWorkflowNotices, visualWorkflowNoticesKey } from './use-visual-workflow-notices'
import { VISUAL_CATEGORY_STATES, type VisualCategoryStep, type VisualCategoryWorkflow, type VisualWorkflowAction } from './visual-category-workflow'
import type { LocalTeamMember, WorkRequestRecord } from './work-request-types'

const workerCompleteStates = ['supervisor_review', 'middle_revision', 'requester_review', 'supervisor_revision', 'confirmed']

export function VisualCategoryWorkflowPanel({
  request, workflow, category, step, viewerId, canManage, supervisors, members, memberName, confirmationHost, requesterOnly,
  feedbackHost,
}: {
  request: Pick<WorkRequestRecord, 'id' | 'requesterId' | 'revision' | 'status'>
  workflow: VisualCategoryWorkflow
  category: { id: string; label: string; assignment?: { assigneeId: string } }
  step: VisualCategoryStep
  viewerId: string
  canManage: boolean
  supervisors: readonly string[]
  members: readonly LocalTeamMember[]
  memberName: (id: string) => string
  confirmationHost: HTMLDivElement | null
  requesterOnly: boolean
  feedbackHost: HTMLDivElement | null
}) {
  const cache = useQueryClient()
  const active = useWorkspaceTabActivity()
  const preview = usePagePreview()
  const { profile, session } = useAuth()
  const valid = profile?.status === 'active' && profile.id === viewerId && session?.user.id === viewerId && !preview?.active
  const closed = ['completed', 'cancelled', 'rejected'].includes(request.status)
  const approver = visualFinalApprover(workflow, supervisors)
  const canSupervise = !requesterOnly && supervisors.includes(viewerId) && (!approver || approver === viewerId)
  const isMiddle = !requesterOnly && Boolean(viewerId && category.assignment?.assigneeId === viewerId && members.some(member => member.id === viewerId))
  const isWorker = !requesterOnly && Boolean(viewerId && step.workerId === viewerId && members.some(member => member.id === viewerId))
  const isRequester = request.requesterId === viewerId
  const received = Boolean(workflow.receivedAt)
  const { state } = step
  const historyAllowed = canManage || canSupervise || isMiddle || isWorker || isRequester
  const history = useQuery({
    ...sharedReadPolicy,
    queryKey: ['visual-workflow-history', viewerId, request.id, category.id, request.revision],
    queryFn: () => getVisualWorkflowReview(request.id, category.id),
    enabled: active && valid && received && historyAllowed,
  })
  const [note, setNote] = useState('')
  const [link, setLink] = useState('')
  const [person, setPerson] = useState<string | null>(null)
  const [choosingWorker, setChoosingWorker] = useState(false)
  const [requestingRevision, setRequestingRevision] = useState(false)
  const [supervisorChoice, setSupervisorChoice] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const command = useRef<{ key: string; id: string } | null>(null)
  const changeable = active && valid && !closed && !saving
  const workerChoice = person ?? (members.some(member => member.id === step.workerId) ? step.workerId ?? '' : '')
  const review = !received ? null
    : state === 'middle_review' && isMiddle ? { approve: 'middle_approve', return: 'middle_return', label: '중간 검수 통과' } as const
    : state === 'supervisor_review' && canSupervise ? { approve: 'supervisor_approve', return: 'supervisor_return', label: '총괄 검수 통과 · 요청자에게 보내기' } as const
    : state === 'requester_review' && isRequester ? { approve: 'requester_confirm', return: 'requester_return', label: '이 분류 결과 확인' } as const
    : null
  const canSubmit = received && state === 'working' && isWorker
  const canForwardToMiddle = received && state === 'supervisor_revision' && canSupervise
  const canForwardToWorker = received && state === 'middle_revision' && isMiddle
  const showSupervisorConfirmation = !received && !closed && canSupervise
  const showMiddleConfirmation = !closed && isMiddle && state === 'assignment'
  const canReassignWorker = received && isMiddle && state === 'working'
  const showConfirmation = Boolean(confirmationHost && (showSupervisorConfirmation || showMiddleConfirmation))
  const canAssignSupervisor = !requesterOnly && canManage && !closed && supervisors.length > 0
    && (supervisors.length > 1 || Boolean(workflow.approverId && !supervisors.includes(workflow.approverId)))
  const publicResult = history.data?.result ?? history.data?.entries.find(entry => entry.action === 'submit' && entry.sharedAt) ?? null
  const currentResult = requesterOnly || history.data?.role === 'requester'
    ? publicResult?.id === step.resultId && publicResult
    : history.data?.entries.find(item => item.id === step.resultId)
  const seen = useReadVisualWorkflowNotices(request.id, category.id, request.revision,
    valid && historyAllowed && (history.isSuccess || !received)
      && (!isRequester || state !== 'requester_review' || Boolean(currentResult)))
  const confirmed = Object.values(workflow.categories).filter(item => item.state === 'confirmed').length
  const total = Object.keys(workflow.categories).length
  const requesterReview = review?.return === 'requester_return'
  const visibleNote = canSubmit || canForwardToMiddle || canForwardToWorker || (review && (!requesterReview || requestingRevision))
  const statusLabel = requesterOnly && !['confirmed', 'requester_review'].includes(state) && !closed
    ? '결과 준비 중' : received ? VISUAL_CATEGORY_STATES[state] : '총괄 접수 대기'
  const refresh = () => Promise.all([
    cache.invalidateQueries({ queryKey: ['work-requests', viewerId] }),
    cache.invalidateQueries({ queryKey: ['department-work', viewerId] }),
    cache.invalidateQueries({ queryKey: visualWorkflowNoticesKey(viewerId) }),
  ])

  async function change(action: VisualWorkflowAction, target: string | null = null) {
    if (!changeable || !request.revision || inFlight.current) return
    const revision = request.revision
    const writeNote = action === 'submit' || action === 'assign_worker' || action.endsWith('_return') || action.endsWith('_forward') ? note.trim() : ''
    const resultUrl = action === 'submit' ? link.trim() : ''
    const key = JSON.stringify([revision, action, target, writeNote, resultUrl])
    const id = command.current?.key === key ? command.current.id : crypto.randomUUID()
    command.current = { key, id }
    setError('')
    setSaving(true)
    inFlight.current = true
    let committed = false
    try {
      await diagnosticOperation('app', 'visual_category_' + action, async trace => {
        trace.step('validate_input')
        if (resultUrl && !/^https?:\/\/[^\s]+$/.test(resultUrl)) {
          trace.block('invalid_result_link')
          throw new Error('http:// 또는 https://로 시작하는 결과물 링크를 입력해 주세요.')
        }
        await trace.run('save', context => changeVisualCategoryWork({
          request: request.id, category: category.id, revision, action, person: target, note: writeNote, resultUrl, command: id,
        }, context))
        committed = true
        await trace.run('refresh_queries', refresh, { writeOutcome: 'committed' })
      })
      command.current = null
      setNote('')
      setLink('')
      setPerson(null)
      setChoosingWorker(false)
      setRequestingRevision(false)
      setSupervisorChoice('')
    } catch (failure) {
      setError(committed ? '저장했습니다. 최신 내용을 다시 조회해 주세요.'
        : failure instanceof Error ? failure.message : '분류 업무를 저장하지 못했습니다.')
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  const workerSelect = <label className="grid min-w-0 gap-1 text-sm">분류 작업자
    <Select aria-label="분류 작업자" value={workerChoice} disabled={!changeable} autoFocus={choosingWorker} onChange={event => setPerson(event.target.value)}>
      <option value="">Visual 직원 선택</option>
      {members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
    </Select>
  </label>
  const saveFeedback = <>
    {saving && <p role="status" className="text-sm text-muted-foreground">저장 중입니다.</p>}
    {error && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
      {error}<Button type="button" size="sm" variant="outline" onClick={() => void refresh()}>업무 다시 조회</Button>
    </div>}
  </>

  const progress = <Card role="region" aria-label={category.label + ' 작업 진행'}>
    <CardContent className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{category.label} 작업 진행</CardTitle>
        {history.data?.role !== 'worker' && <p className="text-sm text-muted-foreground">전체 결과 확인 {confirmed}/{total}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={state === 'confirmed' ? 'success' : 'outline'}>{statusLabel}</Badge>
        {!requesterOnly && step.workerId && workerCompleteStates.includes(state) && <Badge variant="success">작업자 완료</Badge>}
      </div>
      {canAssignSupervisor && <details>
        <summary className="cursor-pointer text-sm text-muted-foreground">총괄 관리자 배정</summary>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select aria-label="이 요청의 총괄 관리자" value={supervisorChoice || approver || ''} disabled={!changeable} onChange={event => setSupervisorChoice(event.target.value)}>
            <option value="">총괄 관리자 선택</option>
            {supervisors.map(id => <option key={id} value={id}>{memberName(id)}</option>)}
          </Select>
          <Button type="button" variant="outline" disabled={!changeable || !(supervisorChoice || approver) || (supervisorChoice || approver) === workflow.approverId}
            onClick={() => void change('assign_supervisor', supervisorChoice || approver || null)}>총괄 배정 저장</Button>
        </div>
      </details>}
      {!requesterOnly && canManage && received && !closed && !category.assignment?.assigneeId && <p className="text-sm text-muted-foreground">업무 관리에서 이 분류의 중간 관리자를 먼저 지정해 주세요.</p>}
      {!closed && (canReassignWorker || canForwardToWorker) && <div className="flex flex-wrap items-end gap-2">
        {workerSelect}
        {canReassignWorker && <Button type="button" disabled={!changeable || !workerChoice || workerChoice === step.workerId}
          onClick={() => void change('assign_worker', workerChoice)}>작업자 지정</Button>}
        {canReassignWorker && workerChoice && workerChoice !== step.workerId && <label className="grid w-full gap-1 text-sm">인계할 지시 (선택)
          <Textarea rows={2} maxLength={2000} value={note} disabled={!changeable} onChange={event => setNote(event.target.value)} />
        </label>}
      </div>}
      {historyAllowed && history.isPending && received && <p role="status" className="text-sm text-muted-foreground">분류 기록을 불러오는 중입니다.</p>}
      {historyAllowed && history.isError && <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">분류 기록을 불러오지 못했습니다.
        <Button type="button" variant="outline" size="sm" onClick={() => void history.refetch()}>기록 다시 조회</Button>
      </p>}
      {historyAllowed && history.data && <VisualWorkflowHistory feedbackHost={feedbackHost} review={requesterOnly
        ? { role: 'requester', result: publicResult, entries: [], assignments: [] } : history.data} />}
      {!closed && (visibleNote || requesterReview) && <div className="space-y-2">
        {visibleNote && <label className="grid gap-1 text-sm">{canSubmit ? '결과 내용' : '수정 의견'}
          <Textarea rows={3} maxLength={canSubmit ? 10000 : 2000} value={note} disabled={!changeable} onChange={event => setNote(event.target.value)} />
        </label>}
        {canSubmit && <label className="grid gap-1 text-sm">결과물 링크
          <Input type="url" placeholder="https://" maxLength={2048} value={link} disabled={!changeable} onChange={event => setLink(event.target.value)} />
        </label>}
        <div className="flex flex-wrap gap-2">
          {canSubmit && <Button type="button" disabled={!changeable || (!note.trim() && !link.trim())} onClick={() => void change('submit')}>결과물 제출</Button>}
          {review && <>
            <Button type="button" disabled={!changeable || !currentResult} onClick={() => void change(review.approve)}>{review.label}</Button>
            {requesterReview && !requestingRevision ? <Button type="button" variant="outline" disabled={!changeable || !currentResult}
              onClick={() => setRequestingRevision(true)}>수정 요청</Button> : <>
              <Button type="button" variant="outline" disabled={!changeable || !currentResult || !note.trim()}
                onClick={() => void change(review.return)}>{requesterReview ? '수정 요청 보내기' : '수정 요청'}</Button>
              {requesterReview && <Button type="button" variant="ghost" disabled={saving}
                onClick={() => { setRequestingRevision(false); setNote('') }}>취소</Button>}
            </>}
          </>}
          {canForwardToMiddle && <Button type="button" disabled={!changeable || !note.trim()} onClick={() => void change('supervisor_forward')}>중간 관리자에게 수정 전달</Button>}
          {canForwardToWorker && <Button type="button" disabled={!changeable || !note.trim() || !workerChoice} onClick={() => void change('middle_forward', workerChoice)}>작업자에게 수정 전달</Button>}
        </div>
      </div>}
      {!showConfirmation && saveFeedback}
      {seen.error && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
        알림 읽음을 저장하지 못했습니다.<Button type="button" size="sm" variant="outline" onClick={seen.retry}>읽음 다시 저장</Button>
      </div>}
    </CardContent>
  </Card>
  return <>
    {progress}
    {confirmationHost && showConfirmation && createPortal(
      <section aria-label="업무 확인" className="space-y-2 border-t border-border bg-card px-4 py-3 sm:px-8 lg:px-10">
        {saveFeedback}
        <div className="flex flex-wrap items-end justify-end gap-2">
          {showSupervisorConfirmation && <Button type="button" disabled={!changeable} onClick={() => void change('receipt')}>총괄 확인</Button>}
          {showMiddleConfirmation && (received && choosingWorker
            ? <form className="flex w-full flex-wrap items-end justify-end gap-2 sm:w-auto" onSubmit={event => {
              event.preventDefault()
              if (workerChoice) void change('assign_worker', workerChoice)
            }}>
              {workerSelect}
              <Button type="button" variant="outline" disabled={saving} onClick={() => { setChoosingWorker(false); setPerson(null) }}>취소</Button>
              <Button type="submit" disabled={!changeable || !workerChoice}>작업자 지정</Button>
            </form>
            : <Button type="button" variant={received ? 'default' : 'outline'} disabled={!changeable || !received}
              onClick={() => setChoosingWorker(true)}>중간 관리자 확인</Button>)}
        </div>
      </section>, confirmationHost,
    )}
  </>
}
