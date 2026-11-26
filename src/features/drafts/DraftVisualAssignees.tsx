import { useEffect, useRef, useState } from 'react'
import { useDraftLoading } from './DraftLoading'
import { createPortal } from 'react-dom'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { draftVisualSaveError } from '@/lib/supabase/draft-visual-content'
import type { DraftVisualBoardRow } from './use-draft-visual-board'

function AssigneeDialog({ board, onClose }: { board: DraftVisualBoardRow; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [selected, setSelected] = useState(() => board.status?.assignee_ids ?? [])
  const [revision, setRevision] = useState(() => board.status?.assignee_revision ?? null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const changedElsewhere = revision !== (board.status?.assignee_revision ?? null)
  const employees = board.employees
  useDraftLoading(saving && 'Visual 팀 담당자를 저장하는 중…', true)
  const inactive = employees ? selected.filter(id => !employees.some(member => member.id === id)) : []

  useEffect(() => { dialog.current?.showModal() }, [])

  async function save() {
    setSaving(true)
    setError('')
    try {
      await board.saveAssignees(selected, revision)
      dialog.current?.close()
    } catch (error) {
      setError(draftVisualSaveError(error))
    } finally {
      setSaving(false)
    }
  }

  return createPortal(<dialog ref={dialog} aria-label="Visual 팀 담당자 지정"
    className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border border-border bg-card p-4 text-foreground shadow-xl backdrop:bg-black/35"
    onCancel={event => { if (saving) event.preventDefault() }} onClose={onClose}>
    <h2 className="text-base font-semibold">Visual 팀 담당자</h2>
    {employees && <div className="my-3 max-h-[50vh] space-y-1.5 overflow-auto">
      {employees.map(member => <label key={member.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
        <input type="checkbox" checked={selected.includes(member.id)} disabled={saving || changedElsewhere}
          onChange={event => {
            const checked = event.currentTarget.checked
            setSelected(current => checked ? [...current, member.id] : current.filter(id => id !== member.id))
          }} />
        {member.name}
      </label>)}
      {!employees.length && <p className="text-sm text-muted-foreground">선택할 수 있는 Visual 팀 직원이 없습니다.</p>}
      {inactive.length > 0 && <Button type="button" size="sm" variant="outline" disabled={saving || changedElsewhere}
        onClick={() => setSelected(current => current.filter(id => !inactive.includes(id)))}>팀에서 제외된 담당자 해제 ({inactive.length}명)</Button>}
    </div>}
    {board.directoryError ? <p className="my-3 text-sm text-muted-foreground">
      Visual 팀을 불러오지 못했습니다. <Button size="sm" variant="outline" onClick={board.retryDirectory}>다시 조회</Button>
    </p> : !employees && <p role="status" className="my-3 text-sm text-muted-foreground">Visual 팀을 불러오는 중…</p>}
    {changedElsewhere ? <p role="alert" className="mb-2 flex items-center gap-2 text-xs text-danger">
      다른 화면에서 담당자를 먼저 저장했습니다.
      <Button type="button" variant="outline" size="sm" onClick={() => {
        setSelected(board.status?.assignee_ids ?? [])
        setRevision(board.status?.assignee_revision ?? null)
        setError('')
      }}>최신값 불러오기</Button>
    </p> : error && <p role="alert" className="mb-2 text-xs text-danger">{error}</p>}
    <div className="flex justify-end gap-2">
      <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => dialog.current?.close()}>닫기</Button>
      <Button type="button" size="sm" disabled={!employees || saving || changedElsewhere || inactive.length > 0}
        onClick={() => void save()}>{saving ? '저장 중…' : '담당자 저장'}</Button>
    </div>
  </dialog>, document.body)
}

export function DraftVisualAssignees({ board, readOnly }: { board: DraftVisualBoardRow; readOnly: boolean }) {
  const [open, setOpen] = useState(false)
  const ids = board.status?.assignee_ids ?? []
  const names = ids.map(id => board.employees?.find(employee => employee.id === id)?.name ?? (board.employees ? '팀 변경 직원' : '불러오는 중…'))
  const summary = names.length > 1 ? `${names[0]} 외 ${names.length - 1}명` : names[0] ?? '선택'
  const locked = readOnly || !board.ready

  function showEmployees() {
    board.requestDirectory()
    setOpen(true)
  }

  return <div className="draft-color-pad draft-visual-assignee">
    <div className="grid min-w-0 gap-0.5">
      <span className="text-[10px] leading-none text-muted-foreground">담당자</span>
      <Button type="button" variant="outline" className="draft-team-control min-w-16" aria-label="비주얼 팀 담당자"
        aria-haspopup="dialog" title={names.join(', ') || undefined} disabled={locked} onClick={showEmployees}>
        <span className="truncate">{summary}</span>
      </Button>
    </div>
    <Button type="button" variant="outline" size="icon" className="draft-team-control draft-visual-assignee-add"
      aria-label="비주얼 팀 담당자 추가" aria-haspopup="dialog" disabled={locked} onClick={showEmployees}><Plus size={13} aria-hidden="true" /></Button>
    {open && <AssigneeDialog board={board} onClose={() => setOpen(false)} />}
  </div>
}
