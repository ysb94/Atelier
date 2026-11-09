import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { VisualWorkAttachment } from './VisualCategoryComments'
import { formatDateTime } from './work-request-schedule'
import { VISUAL_CATEGORY_STATES, visualReviewGroups, type VisualCategoryStep, type VisualRevisionCounts,
  type VisualWorkflowEntry, type VisualWorkflowEntryAction, type VisualWorkflowReview } from './visual-category-workflow'

const labels: Record<VisualWorkflowEntryAction, string> = {
  submit: '결과물 제출',
  middle_return: '중간 검수 수정 요청',
  supervisor_return: '총괄 검수 수정 요청',
  requester_return: '요청자 수정 요청',
  supervisor_forward: '중간 관리자에게 수정 전달',
  middle_forward: '작업자에게 수정 전달',
  assign_worker: '작업자 배정',
  middle_approve: '중간 검수 합격',
  supervisor_approve: '총괄 검수 합격',
  requester_confirm: '요청자 확인 완료',
}

function ResultContent({ entry }: { entry: VisualWorkflowEntry }) {
  return <>
    {entry.note && <p className="whitespace-pre-wrap break-words text-sm">{entry.note}</p>}
    {entry.resultUrl && <a className="break-all text-sm text-primary underline" href={entry.resultUrl}
      target="_blank" rel="noopener noreferrer">결과물 링크 열기</a>}
    {!!entry.files?.length && <div className="flex flex-wrap gap-2">
      {entry.files.map(file => <VisualWorkAttachment key={file.path} file={file} />)}
    </div>}
  </>
}

function FeedbackEntries({ entries }: { entries: VisualWorkflowEntry[] }) {
  return <ol className="space-y-3">
    {[...entries].reverse().map(entry => <li key={entry.id} className="space-y-1 border-t border-border pt-3 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <strong className="text-sm">{labels[entry.action]}{entry.actorName && ' · ' + entry.actorName}</strong>
        <time dateTime={entry.createdAt} className="text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</time>
      </div>
      <ResultContent entry={entry} />
    </li>)}
  </ol>
}

function revisionCounts(assignment: VisualRevisionCounts) {
  const counts = [`중간 수정 ${assignment.middle ?? 0}회`]
  if (assignment.supervisor != null) counts.push(`총괄 수정 ${assignment.supervisor}회`)
  if (assignment.requester != null) counts.push(`요청자 수정 ${assignment.requester}회`)
  return counts.join(' · ')
}

function FeedbackRow({ summary, children }: { summary: string; children?: ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  if (!children) return <p className="py-2 text-sm font-medium">{summary}</p>
  return <details className="group" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary className="flex cursor-pointer list-none items-center gap-2 py-2 text-sm font-medium hover:text-primary [&::-webkit-details-marker]:hidden">
      <span>{summary}</span>
      <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground group-open:rotate-180" />
    </summary>
    {expanded && <div className="space-y-2 pb-3">{children}</div>}
  </details>
}

function CurrentFeedback({ host, counts }: { host: HTMLDivElement | null; counts: string }) {
  return host && createPortal(
    <section aria-label="현재 구간 수정 횟수" className="rounded-lg border border-border px-3">
      <FeedbackRow summary={counts} />
    </section>, host,
  )
}

export function VisualWorkflowHistory({ review, feedbackHost, step }: {
  review: VisualWorkflowReview
  feedbackHost: HTMLDivElement | null
  step: VisualCategoryStep
}) {
  if (review.role === 'requester') {
    return review.result ? <section aria-label="검수 통과 결과물" className="space-y-2 rounded-lg border border-border p-3">
      <h4 className="text-sm font-semibold">검수 통과 결과물</h4>
      <ResultContent entry={review.result} />
    </section> : null
  }
  if (review.role === 'worker') {
    const currentCounts = `중간 수정 ${review.assignments[0]?.middle ?? 0}회`
    const pastAssignments = review.pastAssignments ?? review.previousMiddleCounts?.map(middle => ({ id: null, middle, entries: [] }))
    return <>
      <CurrentFeedback host={feedbackHost} counts={currentCounts} />
      {review.handoff && <section aria-label="인계받은 시안" className="space-y-2 rounded-lg border border-border p-3">
        <h4 className="text-sm font-semibold">인계받은 시안{review.handoff.actorName && ' · ' + review.handoff.actorName}</h4>
        <ResultContent entry={review.handoff} />
      </section>}
      <section aria-label="중간 관리자 피드백" className="rounded-lg border border-border px-3">
        <ol className="divide-y divide-border">
          {pastAssignments?.map(({ id, middle, entries }, index) => <li key={id ?? index}>
            <FeedbackRow summary={`중간 수정 ${middle}회`}>
              {entries.length > 0 && <FeedbackEntries entries={entries} />}
            </FeedbackRow>
          </li>)}
          <li>
            <FeedbackRow summary={currentCounts}>
              {review.entries.length > 0 && <FeedbackEntries entries={review.entries} />}
            </FeedbackRow>
          </li>
        </ol>
      </section>
    </>
  }

  const priorEntries = review.entries.filter(entry => !entry.assignmentId && entry.action !== 'supervisor_forward')
  const current = review.assignments.at(-1)
  if (priorEntries.length === 0 && !current) return null
  const { groups, requesterCount } = visualReviewGroups(review)
  const active = groups.at(-1)
  const counts = review.currentCounts ?? {
    middle: current?.middle,
    supervisor: active?.openedBy ? active.supervisorCount : current?.supervisor,
    requester: requesterCount || current?.requester,
  }
  const checkingResult = step.state === 'middle_review' || step.state === 'supervisor_review'
  const pendingFeedback = step.state === 'supervisor_revision' ? ['requester_return']
    : step.state === 'middle_revision' ? ['supervisor_return', 'supervisor_forward'] : []
  const reviewItem = review.entries.find(entry => checkingResult ? entry.id === step.resultId : pendingFeedback.includes(entry.action))
  return <>
    {current && <CurrentFeedback host={feedbackHost} counts={revisionCounts(counts)} />}
    {reviewItem && <section aria-label={checkingResult ? '현재 검수 결과물' : '전달할 수정 의견'} className="space-y-2 rounded-lg border border-border p-3">
      <h4 className="text-sm font-semibold">{checkingResult ? '현재 검수 결과물' : labels[reviewItem.action]}</h4>
      <ResultContent entry={reviewItem} />
    </section>}
    <section aria-label="배정·수정 이력" className="divide-y divide-border rounded-lg border border-border px-3">
      <h4 className="py-2 text-sm font-semibold">작업 누적</h4>
      {priorEntries.length > 0 && <FeedbackRow summary="이전 기록">
        <FeedbackEntries entries={priorEntries} />
      </FeedbackRow>}
      {groups.map((group, groupIndex) => <section key={group.openedBy?.id ?? 'first'} className="space-y-1 py-3">
        <h5 className="text-sm font-semibold">
          {groupIndex === 0 ? '첫 작업' : `요청자 수정 ${groupIndex}회 반영`} · 총괄 수정 {group.supervisorCount}회
        </h5>
        {group.openedBy && <FeedbackRow summary="요청 의견과 전달 기록">
          <FeedbackEntries entries={group.requesterFeedback ? [group.openedBy, group.requesterFeedback] : [group.openedBy]} />
        </FeedbackRow>}
        {group === active && group.openedBy && !group.assignments.length && <p className="text-sm text-muted-foreground">작업자 재배정 대기</p>}
        <ol className="divide-y divide-border sm:pl-3">
          {group.assignments.map(({ assignment, index, entries }) => {
            const outcome = group === active && assignment === current ? VISUAL_CATEGORY_STATES[step.state]
              : entries.some(entry => entry.action === 'supervisor_approve' || (entry.action === 'submit' && entry.sharedAt)) ? '총괄 합격'
              : entries.some(entry => entry.action === 'supervisor_return') ? '총괄 수정 요청' : ''
            const label = [`${index + 1}구간`, assignment.workerName || '기존 기록', `중간 수정 ${assignment.middle ?? 0}회`, outcome]
              .filter(Boolean).join(' · ')
            return <li key={assignment.id ?? index}>
              <FeedbackRow summary={label}>
                {assignment.assignedAt && <time dateTime={assignment.assignedAt} className="text-xs text-muted-foreground">
                  배정 {formatDateTime(assignment.assignedAt)}
                </time>}
                {entries.length > 0 && <FeedbackEntries entries={entries} />}
              </FeedbackRow>
            </li>
          })}
        </ol>
      </section>)}
    </section>
  </>
}
