import { useRef, useState } from 'react'
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
import { changeVisualCategoryWork, listVisualWorkflowEntries } from '@/lib/supabase/visual-category-workflow'
import { formatDateTime } from './work-request-schedule'
import { visualFinalApprover } from './visual-final-approval'
import { useReadVisualWorkflowNotices, visualWorkflowNoticesKey } from './use-visual-workflow-notices'
import { VISUAL_CATEGORY_STATES, type VisualCategoryStep, type VisualCategoryWorkflow, type VisualWorkflowAction, type VisualWorkflowEntryAction } from './visual-category-workflow'
import type { LocalTeamMember, WorkRequestRecord } from './work-request-types'

const historyLabels: Record<VisualWorkflowEntryAction, string> = {
  submit: '결과물 제출',
  middle_return: '중간 검수 수정 요청',
  supervisor_return: '총괄 검수 수정 요청',
  requester_return: '요청자 수정 요청',
  supervisor_forward: '중간 관리자에게 수정 전달',
  middle_forward: '작업자에게 수정 전달',
}
const workerCompleteStates = ['supervisor_review', 'middle_revision', 'requester_review', 'supervisor_revision', 'confirmed']

export function VisualCategoryWorkflowPanel({
  request, workflow, category, step, viewerId, canManage, supervisors, members, memberName,
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
}) {
  const cache = useQueryClient()
  const active = useWorkspaceTabActivity()
  const preview = usePagePreview()
  const { profile, session } = useAuth()
  const valid = profile?.status === 'active' && profile.id === viewerId && session?.user.id === viewerId && !preview?.active
  const closed = ['completed', 'cancelled', 'rejected'].includes(request.status)
  const approver = visualFinalApprover(workflow, supervisors)
  const canSupervise = supervisors.includes(viewerId) && (!approver || approver === viewerId)
  const isMiddle = Boolean(viewerId && category.assignment?.assigneeId === viewerId && members.some(member => member.id === viewerId))
  const isWorker = Boolean(viewerId && step.workerId === viewerId && members.some(member => member.id === viewerId))
  const isRequester = request.requesterId === viewerId
  const received = Boolean(workflow.receivedAt)
  const { state, feedback } = step
  const historyAllowed = canManage || canSupervise || isMiddle || isWorker || isRequester
  const history = useQuery({
    ...sharedReadPolicy,
    queryKey: ['visual-workflow-history', viewerId, request.id, category.id, request.revision],
    queryFn: () => listVisualWorkflowEntries(request.id, category.id),
    enabled: active && valid && historyAllowed,
  })
  const [note, setNote] = useState('')
  const [link, setLink] = useState('')
  const [person, setPerson] = useState<string | null>(null)
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
  const canAssignWorker = received && isMiddle && (state === 'assignment' || state === 'working')
  const canAssignSupervisor = canManage && !closed && supervisors.length > 0
    && (supervisors.length > 1 || Boolean(workflow.approverId && !supervisors.includes(workflow.approverId)))
  const currentResult = history.data?.find(item => item.id === step.resultId)
  const seen = useReadVisualWorkflowNotices(request.id, category.id, request.revision,
    valid && historyAllowed && (history.isSuccess || !received)
      && (!isRequester || state !== 'requester_review' || Boolean(currentResult)))
  const confirmed = Object.values(workflow.categories).filter(item => item.state === 'confirmed').length
  const total = Object.keys(workflow.categories).length
  const visibleNote = canSubmit || canForwardToMiddle || canForwardToWorker || review
  const refresh = () => Promise.all([
    cache.invalidateQueries({ queryKey: ['work-requests', viewerId] }),
    cache.invalidateQueries({ queryKey: ['department-work', viewerId] }),
    cache.invalidateQueries({ queryKey: visualWorkflowNoticesKey(viewerId) }),
  ])

  async function change(action: VisualWorkflowAction, target: string | null = null) {
    if (!changeable || !request.revision || inFlight.current) return
    const revision = request.revision
    const writeNote = action === 'submit' || action.endsWith('_return') || action.endsWith('_forward') ? note.trim() : ''
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
      setSupervisorChoice('')
    } catch (failure) {
      setError(committed ? '저장했습니다. 최신 내용을 다시 조회해 주세요.'
        : failure instanceof Error ? failure.message : '분류 업무를 저장하지 못했습니다.')
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return <Card role="region" aria-label={category.label + ' 작업 진행'}>
    <CardContent className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{category.label} 작업 진행</CardTitle>
        <p className="text-sm text-muted-foreground">전체 결과 확인 {confirmed}/{total}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={state === 'confirmed' ? 'success' : 'outline'}>{received ? VISUAL_CATEGORY_STATES[state] : '총괄 접수 대기'}</Badge>
        {step.workerId && workerCompleteStates.includes(state) && <Badge variant="success">작업자 완료</Badge>}
        <span className="text-sm text-muted-foreground">중간 수정 {feedback?.middle ?? 0}회 · 총괄 수정 {feedback?.supervisor ?? 0}회 · 요청자 수정 {feedback?.requester ?? 0}회</span>
      </div>
      {!received && !closed && canSupervise && <Button type="button" disabled={!changeable} onClick={() => void change('receipt')}>총괄 접수 확인</Button>}
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
      {received && !closed && !category.assignment?.assigneeId && <p className="text-sm text-muted-foreground">업무 관리에서 이 분류의 중간 관리자를 먼저 지정해 주세요.</p>}
      {!closed && (canAssignWorker || canForwardToWorker) && <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">분류 작업자
          <Select aria-label="분류 작업자" value={workerChoice} disabled={!changeable} onChange={event => setPerson(event.target.value)}>
            <option value="">Visual 직원 선택</option>
            {members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
          </Select>
        </label>
        {canAssignWorker && <Button type="button" disabled={!changeable || !workerChoice || workerChoice === step.workerId}
          onClick={() => void change('assign_worker', workerChoice)}>작업자 지정</Button>}
      </div>}
      {historyAllowed && history.isPending && received && <p role="status" className="text-sm text-muted-foreground">분류 기록을 불러오는 중입니다.</p>}
      {historyAllowed && history.isError && <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">분류 기록을 불러오지 못했습니다.
        <Button type="button" variant="outline" size="sm" onClick={() => void history.refetch()}>기록 다시 조회</Button>
      </p>}
      {historyAllowed && currentResult && <div className="space-y-2 rounded-lg border border-border p-3">
        <h4 className="text-sm font-semibold">최근 결과물</h4>
        {currentResult.note && <p className="whitespace-pre-wrap break-words text-sm">{currentResult.note}</p>}
        {currentResult.resultUrl && <a className="break-all text-sm text-primary underline" href={currentResult.resultUrl} target="_blank" rel="noopener noreferrer">결과물 링크 열기</a>}
      </div>}
      {!closed && visibleNote && <div className="space-y-2">
        <label className="grid gap-1 text-sm">{canSubmit ? '결과 내용' : '수정 의견'}
          <Textarea rows={3} maxLength={canSubmit ? 10000 : 2000} value={note} disabled={!changeable} onChange={event => setNote(event.target.value)} />
        </label>
        {canSubmit && <label className="grid gap-1 text-sm">결과물 링크
          <Input type="url" placeholder="https://" maxLength={2048} value={link} disabled={!changeable} onChange={event => setLink(event.target.value)} />
        </label>}
        <div className="flex flex-wrap gap-2">
          {canSubmit && <Button type="button" disabled={!changeable || (!note.trim() && !link.trim())} onClick={() => void change('submit')}>결과물 제출</Button>}
          {review && <>
            <Button type="button" disabled={!changeable || !currentResult} onClick={() => void change(review.approve)}>{review.label}</Button>
            <Button type="button" variant="outline" disabled={!changeable || !currentResult || !note.trim()} onClick={() => void change(review.return)}>수정 요청</Button>
          </>}
          {canForwardToMiddle && <Button type="button" disabled={!changeable || !note.trim()} onClick={() => void change('supervisor_forward')}>중간 관리자에게 수정 전달</Button>}
          {canForwardToWorker && <Button type="button" disabled={!changeable || !note.trim() || !workerChoice} onClick={() => void change('middle_forward', workerChoice)}>작업자에게 수정 전달</Button>}
        </div>
      </div>}
      {historyAllowed && !!history.data?.length && <details>
        <summary className="cursor-pointer text-sm font-medium">분류 결과·수정 이력</summary>
        <ul className="mt-2 space-y-2 text-sm">
          {history.data.map(item => <li key={item.id} className="space-y-1 rounded-lg border border-border p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <strong>{historyLabels[item.action]}</strong>
              <time dateTime={item.createdAt} className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</time>
            </div>
            {item.note && <p className="whitespace-pre-wrap break-words">{item.note}</p>}
            {item.resultUrl && <a className="break-all text-primary underline" href={item.resultUrl} target="_blank" rel="noopener noreferrer">결과물 링크 열기</a>}
          </li>)}
        </ul>
      </details>}
      {saving && <p role="status" className="text-sm text-muted-foreground">저장 중입니다.</p>}
      {error && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
        {error}<Button type="button" size="sm" variant="outline" onClick={() => void refresh()}>업무 다시 조회</Button>
      </div>}
      {seen.error && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
        알림 읽음을 저장하지 못했습니다.<Button type="button" size="sm" variant="outline" onClick={seen.retry}>읽음 다시 저장</Button>
      </div>}
    </CardContent>
  </Card>
}
