import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { listPersonalWorkMembers, personalWorkErrorMessage, type PersonalWorkCard, type PersonalWorkInput } from '@/lib/supabase/personal-work'
import { MyWorkCardHistory } from './MyWorkCardHistory'

type Command = Omit<PersonalWorkInput, 'id' | 'revision' | 'command'>
const dateFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' })

export function MyWorkCardDrawer({ actorId, card, statusLabel, onClose, onAction, onRequestReview }: {
  actorId: string
  card?: PersonalWorkCard
  statusLabel?: string
  onClose: () => void
  onAction: (input: PersonalWorkInput) => Promise<void>
  onRequestReview?: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const headingId = useId()
  const [draftId] = useState(() => card?.id ?? crypto.randomUUID())
  const [title, setTitle] = useState(card?.title ?? '')
  const [description, setDescription] = useState(card?.description ?? '')
  const [assignee, setAssignee] = useState('')
  const [note, setNote] = useState('')
  const [confirmation, setConfirmation] = useState<'delete' | 'revise' | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const command = useRef<{ key: string; id: string }>(null)
  const baseRevision = useRef(card?.revision)
  const members = useQuery({ queryKey: ['personal-work-members', actorId], queryFn: listPersonalWorkMembers, enabled: !card, retry: false })
  const nextTitle = title.trim()
  const changed = nextTitle !== card?.title || description !== card?.description
  const isAssignee = card?.assignee_id === actorId
  const isCreator = card?.created_by === actorId
  const canEdit = !card || ((isAssignee || isCreator) && card.status !== 'feedback')
  const canReview = card?.status === 'feedback' && card.reviewer_id === actorId
  const canDelete = card && isCreator && card.status !== 'feedback'

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  function close() {
    if (inFlight.current) return
    dialog.current?.close()
    onClose()
  }

  async function submit(fields: Command) {
    if (inFlight.current) return
    const revision = fields.action === 'edit' ? baseRevision.current : card?.revision
    const key = JSON.stringify({ fields, revision })
    if (command.current?.key !== key) command.current = { key, id: crypto.randomUUID() }
    inFlight.current = true
    setPending(true)
    setError('')
    try {
      await onAction({ ...fields, id: draftId, revision, command: command.current.id })
      inFlight.current = false
      close()
    } catch (failure) {
      setError(personalWorkErrorMessage(failure))
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return <dialog ref={dialog} aria-labelledby={headingId}
    className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-2xl border-l border-border bg-card text-card-foreground shadow-2xl backdrop:bg-black/20"
    onCancel={event => { event.preventDefault(); close() }}>
    <form className="flex h-full min-w-0 flex-col" onSubmit={event => {
      event.preventDefault()
      if (canEdit && nextTitle && changed && !confirmation) void submit({
        action: card ? 'edit' : 'create', title: nextTitle, description, assignee: !card && assignee ? assignee : undefined,
      })
    }}>
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-4 py-5 sm:px-8">
        <div className="min-w-0">
          <h2 id={headingId} className="text-xl font-semibold tracking-tight">{card ? '업무 카드 상세' : '업무 카드 추가'}</h2>
          {card && <p className="mt-1 text-sm text-muted-foreground">{statusLabel} · {card.round}차</p>}
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="업무 카드 창 닫기" disabled={pending} onClick={close}>
          <X size={20} aria-hidden="true" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-8">
        {!card && <div className="space-y-2">
          <label className="grid gap-2 text-sm font-medium">업무 담당자
            <Select className="w-full" value={assignee} onChange={event => setAssignee(event.currentTarget.value)} disabled={pending}>
              <option value="">나 · 내 업무</option>
              {members.data?.map(member => <option key={member.id} value={member.id}>
                {member.name}{member.position ? ` · ${member.position}` : ''}
              </option>)}
            </Select>
          </label>
          {assignee && <p className="text-sm text-muted-foreground">피드백 담당자 · 나 (업무를 배정한 사람)</p>}
          {members.isPending && <p role="status" className="text-xs text-muted-foreground">같은 부서원을 불러오는 중입니다.</p>}
          {members.isError && <Button type="button" size="sm" variant="outline" onClick={() => void members.refetch()}>부서원 다시 불러오기</Button>}
        </div>}
        {card && <dl className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <div><dt className="inline">등록 · </dt><dd className="inline">{card.creator_name} · {dateFormat.format(new Date(card.created_at))}</dd></div>
          <div><dt className="inline">업무 담당자 · </dt><dd className="inline">{card.assignee_name}</dd></div>
          {card.reviewer_name && <div><dt className="inline">피드백 담당자 · </dt><dd className="inline">{card.reviewer_name}</dd></div>}
        </dl>}
        {canEdit ? <>
          <label className="grid gap-2 text-sm font-medium">제목
            <Input autoFocus value={title} required maxLength={120} disabled={pending} onChange={event => setTitle(event.currentTarget.value)} />
          </label>
          <label className="grid gap-2 text-sm font-medium">내용
            <Textarea rows={card ? 5 : 9} value={description} maxLength={10000} placeholder="업무 내용을 입력하세요."
              className="resize-y py-2.5 font-normal" disabled={pending} onChange={event => setDescription(event.currentTarget.value)} />
          </label>
        </> : <div className="space-y-2">
          <h3 className="wrap-anywhere text-base font-semibold">{card?.title}</h3>
          {card?.description && <p className="wrap-anywhere whitespace-pre-wrap text-sm">{card.description}</p>}
        </div>}
        {card && <MyWorkCardHistory card={card} />}
        {confirmation === 'revise' && <label className="grid gap-2 text-sm font-medium">수정할 내용
          <Textarea autoFocus rows={4} value={note} maxLength={3600} disabled={pending} className="py-2"
            onChange={event => setNote(event.currentTarget.value)} />
        </label>}
      </div>
      <footer className="shrink-0 space-y-2 border-t border-border px-4 py-4 sm:px-8">
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {confirmation === 'delete' ? <>
            <p className="mr-auto text-sm font-medium text-danger" role="status">이 카드를 삭제할까요?</p>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmation(null)}>삭제 취소</Button>
            <Button type="button" variant="danger" disabled={pending} onClick={() => void submit({ action: 'delete' })}>삭제 확인</Button>
          </> : confirmation === 'revise' ? <>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmation(null)}>취소</Button>
            <Button type="button" disabled={pending || !note.trim()} onClick={() => void submit({ action: 'revise', note })}>수정 요청 보내기</Button>
          </> : <>
            {canDelete && <Button type="button" variant="ghost" className="mr-auto text-danger" disabled={pending} onClick={() => setConfirmation('delete')}>
              <Trash2 size={16} aria-hidden="true" />삭제
            </Button>}
            <Button type="button" variant="outline" disabled={pending} onClick={close}>{canEdit ? '취소' : '닫기'}</Button>
            {canEdit && <Button type="submit" disabled={pending || !nextTitle || !changed}>{card ? '저장' : '추가'}</Button>}
            {isAssignee && card?.status === 'todo' && <Button type="button" variant="outline" disabled={pending || changed}
              onClick={() => void submit({ action: 'start' })}>
              {card.events.some(event => event.round === card.round && event.kind === 'paused') ? '재개' : '시작'}
            </Button>}
            {isAssignee && card?.status === 'doing' && <>
              <Button type="button" variant="outline" disabled={pending || changed} onClick={() => void submit({ action: 'pause' })}>일시정지</Button>
              <Button type="button" variant="outline" disabled={pending || changed} onClick={onRequestReview}>피드백 요청</Button>
              {isCreator && <Button type="button" variant="outline" disabled={pending || changed} onClick={() => void submit({ action: 'complete' })}>완료</Button>}
            </>}
            {canReview && <>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmation('revise')}>수정 요청</Button>
              <Button type="button" disabled={pending} onClick={() => void submit({ action: 'approve' })}>승인</Button>
            </>}
          </>}
        </div>
      </footer>
    </form>
  </dialog>
}
