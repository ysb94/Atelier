import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { formatDateTime } from './work-request-schedule'
import type { VisualWorkflowAssignment, VisualWorkflowEntry, VisualWorkflowEntryAction, VisualWorkflowReview } from './visual-category-workflow'

const labels: Record<VisualWorkflowEntryAction, string> = {
  submit: '결과물 제출',
  middle_return: '중간 검수 수정 요청',
  supervisor_return: '총괄 검수 수정 요청',
  requester_return: '요청자 수정 요청',
  supervisor_forward: '중간 관리자에게 수정 전달',
  middle_forward: '작업자에게 수정 전달',
  assign_worker: '작업 인계 지시',
}

function ResultContent({ entry }: { entry: VisualWorkflowEntry }) {
  return <>
    {entry.note && <p className="whitespace-pre-wrap break-words text-sm">{entry.note}</p>}
    {entry.resultUrl && <a className="break-all text-sm text-primary underline" href={entry.resultUrl}
      target="_blank" rel="noopener noreferrer">결과물 링크 열기</a>}
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

function revisionCounts(assignment: VisualWorkflowAssignment) {
  const counts = [`중간 수정 ${assignment.middle ?? 0}회`]
  if (assignment.supervisor != null) counts.push(`총괄 수정 ${assignment.supervisor}회`)
  if (assignment.requester != null) counts.push(`요청자 수정 ${assignment.requester}회`)
  return counts.join(' · ')
}

function FeedbackRow({ summary, children }: { summary: string; children?: ReactNode }) {
  if (!children) return <p className="py-2 text-sm font-medium">{summary}</p>
  return <details className="group">
    <summary className="flex cursor-pointer list-none items-center gap-2 py-2 text-sm font-medium hover:text-primary [&::-webkit-details-marker]:hidden">
      <span>{summary}</span>
      <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground group-open:rotate-180" />
    </summary>
    <div className="space-y-2 pb-3">{children}</div>
  </details>
}

export function VisualWorkflowHistory({ review, feedbackHost }: {
  review: VisualWorkflowReview
  feedbackHost: HTMLDivElement | null
}) {
  if (review.role === 'requester') {
    return review.result ? <section aria-label="검수 통과 결과물" className="space-y-2 rounded-lg border border-border p-3">
      <h4 className="text-sm font-semibold">검수 통과 결과물</h4>
      <ResultContent entry={review.result} />
    </section> : null
  }
  if (review.role === 'worker') {
    return <>
      {review.handoff && <section aria-label="인계받은 시안" className="space-y-2 rounded-lg border border-border p-3">
        <h4 className="text-sm font-semibold">인계받은 시안{review.handoff.actorName && ' · ' + review.handoff.actorName}</h4>
        <ResultContent entry={review.handoff} />
      </section>}
      {feedbackHost && createPortal(<section aria-label="중간 관리자 피드백" className="rounded-lg border border-border px-3">
        <FeedbackRow summary={`중간 수정 ${review.assignments[0]?.middle ?? 0}회`}>
          {review.entries.length > 0 && <FeedbackEntries entries={review.entries} />}
        </FeedbackRow>
      </section>, feedbackHost)}
    </>
  }

  if (!feedbackHost) return null
  const priorEntries = review.entries.filter(entry => !entry.assignmentId)
  if (priorEntries.length === 0 && review.assignments.length === 0) return null
  return createPortal(<section aria-label="배정·수정 이력" className="divide-y divide-border rounded-lg border border-border px-3">
    {priorEntries.length > 0 && <FeedbackRow summary="이전 기록">
      <FeedbackEntries entries={priorEntries} />
    </FeedbackRow>}
    <ol className="divide-y divide-border">
      {review.assignments.map((assignment, index) => {
        const entries = assignment.id ? review.entries.filter(entry => entry.assignmentId === assignment.id) : []
        const reason = assignment.reason === 'handoff' ? '작업자 재배정' : assignment.reason === 'review' ? '수정 작업 배정' : ''
        return <li key={assignment.id ?? index}>
          <FeedbackRow summary={revisionCounts(assignment)}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <strong>{index + 1}구간 · {assignment.workerName || '기존 기록'}</strong>
              {reason && <span>{reason}</span>}
              {assignment.assignedAt && <time dateTime={assignment.assignedAt} className="text-xs text-muted-foreground">
                {formatDateTime(assignment.assignedAt)}
              </time>}
            </div>
            {entries.length > 0 && <FeedbackEntries entries={entries} />}
          </FeedbackRow>
        </li>
      })}
    </ol>
  </section>, feedbackHost)
}
