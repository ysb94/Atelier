import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useDraftLoading } from './DraftLoading'

export function DraftTeamActions({ label, className, confirmText = '확정', confirmBlockedReason, showSave = true, locked, confirmed, editing, conflict, busy, onEdit, onSave, onReset }: {
  label: string
  className?: string
  confirmText?: string
  confirmBlockedReason?: string
  showSave?: boolean
  locked: boolean
  confirmed: boolean
  editing: boolean
  conflict: boolean
  busy: boolean
  onEdit: () => void
  onSave: (confirmed: boolean) => void
  onReset: () => void
}) {
  useDraftLoading(busy && `${label} 저장 중…`, true)
  return <div className={cn('draft-team-actions', className)} aria-busy={busy} title={confirmed ? undefined : confirmBlockedReason}>
    {conflict ? <Button type="button" variant="outline" size="sm" className="draft-team-control" disabled={locked}
      aria-label={`${label} 최신값 불러오기`} onClick={onReset}>다시 조회</Button> : <>
      {showSave && !confirmed && <Button type="button" variant="outline" size="sm" className="draft-team-control"
        aria-label={`${label} 저장`} disabled={locked || !editing} onClick={() => onSave(false)}>저장</Button>}
      <Button type="button" variant="outline" size="sm"
        className={cn('draft-team-control draft-team-confirm', confirmed && 'is-confirmed')}
        aria-label={`${label} ${confirmed ? locked ? '확정됨' : '수정' : '확정'}`}
        aria-description={confirmed ? undefined : confirmBlockedReason} disabled={locked || (!confirmed && Boolean(confirmBlockedReason))}
        onClick={confirmed ? onEdit : () => onSave(true)}>{busy ? '저장 중…' : confirmed && !locked ? '수정' : confirmText}</Button>
    </>}
  </div>
}

export function DraftTeamNotice({ error, conflict }: { error: string; conflict: boolean }) {
  if (!error && !conflict) return null
  return <p role="alert" className="draft-team-notice">{conflict ? '다른 화면에서 먼저 저장했습니다. 입력값을 확인한 뒤 다시 조회해 주세요.' : error}</p>
}
