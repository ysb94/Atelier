import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { VisualWorkAttachment } from './VisualCategoryComments'
import { formatDateTime } from './work-request-schedule'
import { visualHistoryEntries, visualReviewGroups, type VisualCategoryStep, type VisualWorkflowAssignment,
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

function ResultContent({ entry, previewImages = true }: { entry: VisualWorkflowEntry; previewImages?: boolean }) {
  return <>
    {entry.note && <p className="whitespace-pre-wrap break-words text-sm">{entry.note}</p>}
    {entry.resultUrl && <a className="break-all text-sm text-primary underline" href={entry.resultUrl}
      target="_blank" rel="noopener noreferrer">결과물 링크 열기</a>}
    {!!entry.files?.length && <div className="flex flex-wrap gap-2">
      {entry.files.map(file => <VisualWorkAttachment key={file.path} file={file} previewImage={previewImages} />)}
    </div>}
  </>
}

function FeedbackEntries({ entries, assignments }: { entries: VisualWorkflowEntry[]; assignments?: VisualWorkflowAssignment[] }) {
  const workers = new Map(assignments?.map(assignment => [assignment.id, assignment.workerName]))
  return <ol className="space-y-3">
    {entries.map(entry => {
      const worker = (entry.action === 'assign_worker' || entry.action === 'middle_forward') && workers.get(entry.assignmentId ?? undefined)
      return <li key={entry.id} className="space-y-1 border-t border-border pt-3 first:border-0 first:pt-0">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <strong className="text-sm">
            {labels[entry.action]}{entry.actorName && ' · ' + entry.actorName}{worker && ' → ' + worker}
          </strong>
          <time dateTime={entry.createdAt} className="text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</time>
        </div>
        <ResultContent entry={entry} previewImages={false} />
      </li>
    })}
  </ol>
}

function RevisionTree({ host, children }: { host: HTMLDivElement | null; children: ReactNode }) {
  return host && createPortal(
    <section aria-label="수정 횟수" className="space-y-1 rounded-lg border border-border px-3 py-2 text-sm">{children}</section>, host,
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
  const entries = visualHistoryEntries(review)
  if (review.role === 'worker') {
    const middleCounts = review.pastAssignments?.map(assignment => assignment.middle) ?? review.previousMiddleCounts ?? []
    return <>
      <RevisionTree host={feedbackHost}>
        <ol className="space-y-0.5">
          {[...middleCounts, review.assignments[0]?.middle ?? 0].map((count, index) => <li key={index}>중간 수정 {count}회</li>)}
        </ol>
      </RevisionTree>
      {review.handoff && <section aria-label="인계받은 시안" className="space-y-2 rounded-lg border border-border p-3">
        <h4 className="text-sm font-semibold">인계받은 시안{review.handoff.actorName && ' · ' + review.handoff.actorName}</h4>
        <ResultContent entry={review.handoff} />
      </section>}
      {entries.length > 0 && <section aria-label="중간 관리자 피드백" className="space-y-3 rounded-lg border border-border p-3">
        <h4 className="text-sm font-semibold">작업 이력</h4>
        <FeedbackEntries entries={entries} />
      </section>}
    </>
  }

  if (!entries.length && !review.assignments.length) return null
  const groups = visualReviewGroups(review)
  const requesterCount = review.currentCounts?.requester ?? review.entries.filter(entry => entry.action === 'requester_return').length
  const checkingResult = step.state === 'middle_review' || step.state === 'supervisor_review'
  const pendingFeedback = step.state === 'supervisor_revision' ? ['requester_return']
    : step.state === 'middle_revision' ? ['supervisor_return', 'supervisor_forward'] : []
  const reviewItem = review.entries.find(entry => checkingResult ? entry.id === step.resultId : pendingFeedback.includes(entry.action))
  return <>
    <RevisionTree host={feedbackHost}>
      {groups.map((group, index) => <details key={group.openedBy?.id ?? 'initial'} open aria-label={`요청자 수정 ${index}회`}>
        <summary className="cursor-pointer font-semibold">요청자 수정 {index}회</summary>
        <div className="ml-2 space-y-0.5 border-l border-border pl-3 sm:ml-3">
          {[...group.rounds].sort(([a], [b]) => a - b).map(([supervisorCount, assignments]) => (
            <details key={supervisorCount} open aria-label={`총괄 수정 ${supervisorCount}회`}>
              <summary className="cursor-pointer font-medium">총괄 수정 {supervisorCount}회</summary>
              {assignments.length > 0 ? <ul className="ml-5 space-y-0.5">
                {assignments.map((assignment, index) => <li key={assignment.id ?? index}>중간 수정 {assignment.middle ?? 0}회</li>)}
              </ul> : index === groups.length - 1 && step.state === 'middle_revision' && (
                <p className="ml-5 text-muted-foreground">작업자 재배정 대기</p>
              )}
            </details>
          ))}
        </div>
      </details>)}
      {step.state === 'supervisor_revision' && <details open aria-label={`요청자 수정 ${requesterCount}회`}>
        <summary className="cursor-pointer font-semibold">요청자 수정 {requesterCount}회</summary>
        <p className="ml-5 text-muted-foreground">중간 관리자에게 의견 전달 대기</p>
      </details>}
    </RevisionTree>
    {reviewItem && <section aria-label={checkingResult ? '현재 검수 결과물' : '전달할 수정 의견'} className="space-y-2 rounded-lg border border-border p-3">
      <h4 className="text-sm font-semibold">{checkingResult ? '현재 검수 결과물' : labels[reviewItem.action]}</h4>
      <ResultContent entry={reviewItem} />
    </section>}
    {entries.length > 0 && <section aria-label="배정·수정 이력" className="space-y-3 rounded-lg border border-border p-3">
      <h4 className="text-sm font-semibold">작업 이력</h4>
      <FeedbackEntries entries={entries} assignments={review.assignments} />
    </section>}
  </>
}
