import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmployeeDirectoryColumns } from '@/components/ui/employee-directory-columns'
import { Input, Select, Textarea } from '@/components/ui/input'
import { chatKeys } from '@/features/chat/use-chat'
import { formatChatPerson } from '@/lib/inbox/format'
import { listChatDirectory } from '@/lib/supabase/chat'
import { personalWorkErrorMessage } from '@/lib/supabase/personal-work'
import { cn } from '@/lib/utils'

export function MyWorkFeedbackDialog({ actorId, settings, cardTitle, recipientIds, fixedReviewer, onSettings, onSave, onRequest, onClose }: {
  actorId?: string
  settings: boolean
  cardTitle?: string
  recipientIds: readonly string[]
  fixedReviewer?: { id: string; name: string }
  onSettings: () => void
  onSave: (ids: string[]) => void
  onRequest: (recipient: string, note: string, command: string) => Promise<void>
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const [savedSelection, setSavedSelection] = useState(() => new Set(recipientIds))
  const [search, setSearch] = useState('')
  const [recipient, setRecipient] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const attempt = useRef<{ id: string; recipient: string; note: string }>(null)
  const inFlight = useRef(false)
  const needsDirectory = settings || !fixedReviewer
  const directory = useQuery({
    queryKey: [...chatKeys.directory, actorId], queryFn: listChatDirectory, enabled: Boolean(actorId) && needsDirectory, retry: false,
  })
  const people = directory.data ?? []
  const available = people.filter(person => recipientIds.includes(person.profileId))
  const reviewerId = fixedReviewer?.id ?? available.find(person => person.profileId === recipient)?.profileId
  const selectedPeople = people.filter(person => savedSelection.has(person.profileId))
  const query = search.trim().toLowerCase()
  const filtered = people.filter(person => [person.displayName, person.departmentName, person.position]
    .some(value => value?.toLowerCase().includes(query)))

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

  function changeSelection(id: string, selected?: boolean) {
    setSavedSelection(current => {
      const next = new Set(current)
      if (selected ?? !current.has(id)) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function requestFeedback() {
    if (!reviewerId || !actorId || !cardTitle || inFlight.current) return
    const message = note.trim()
    const previous = attempt.current
    const id = previous?.recipient === reviewerId && previous.note === message ? previous.id : crypto.randomUUID()
    attempt.current = { id, recipient: reviewerId, note: message }
    inFlight.current = true
    setSending(true)
    setError('')
    try {
      await onRequest(reviewerId, message, id)
      inFlight.current = false
      close()
    } catch (failure) {
      setError(personalWorkErrorMessage(failure))
    } finally {
      inFlight.current = false
      setSending(false)
    }
  }

  return <dialog ref={dialog} aria-labelledby={titleId}
    className={cn('m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl backdrop:bg-black/25',
      settings ? 'max-w-4xl' : 'max-w-lg')}
    onCancel={event => { event.preventDefault(); close() }}
    onClick={event => { if (event.target === event.currentTarget) close() }}>
    <form className="space-y-4" onSubmit={event => {
      event.preventDefault()
      if (!settings) { void requestFeedback(); return }
      if (actorId && directory.isSuccess) {
        if (!cardTitle) dialog.current?.close()
        onSave(selectedPeople.map(person => person.profileId))
      }
    }}>
      <h2 id={titleId} className="text-lg font-semibold">{settings ? '피드백 담당자 설정' : '피드백 요청'}</h2>
      {!actorId ? <p className="text-sm text-muted-foreground">미리보기에서는 피드백 요청을 보낼 수 없습니다.</p>
        : needsDirectory && directory.isPending ? <p role="status" className="text-sm text-muted-foreground">직원 목록을 불러오는 중입니다.</p>
        : needsDirectory && directory.isError ? <div role="alert" className="space-y-2 text-sm text-danger">
          <p>직원 목록을 불러오지 못했습니다.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void directory.refetch()}>다시 불러오기</Button>
        </div> : settings ? <>
          <div role="group" aria-label="선택한 담당자" className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">선택한 담당자 ({selectedPeople.length})</p>
            {selectedPeople.length ? <ul className="flex flex-wrap gap-2">
              {selectedPeople.map(person => {
                const name = formatChatPerson(person.displayName, person.position)
                const label = person.departmentName ? `${name} · ${person.departmentName}` : name
                return <li key={person.profileId}>
                  <Badge className="gap-1 pr-1">
                    {label}
                    <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0 rounded-full text-current hover:bg-primary/15"
                      aria-label={`${label} 선택 해제`} onClick={() => {
                        changeSelection(person.profileId, false)
                        searchInput.current?.focus()
                      }}>
                      <X size={14} aria-hidden="true" />
                    </Button>
                  </Badge>
                </li>
              })}
            </ul> : <p className="text-sm text-muted-foreground">선택한 담당자가 없습니다.</p>}
          </div>
          <Input ref={searchInput} aria-label="직원 검색" placeholder="이름 또는 부서 검색" value={search} onChange={event => setSearch(event.currentTarget.value)} />
          <div className="rounded-md border border-border bg-card p-2">
            {filtered.length ? <EmployeeDirectoryColumns
              people={filtered.map(person => ({ id: person.profileId, name: person.displayName, department: person.departmentName, position: person.position }))}
              isSelected={id => savedSelection.has(id)} className="max-h-[48dvh] overflow-y-auto"
              onSelect={changeSelection} /> : <p className="px-3 py-6 text-center text-sm text-muted-foreground">일치하는 직원이 없습니다.</p>}
          </div>
        </> : <>
          <p className="break-words text-sm font-medium">{cardTitle}</p>
          {fixedReviewer || available.length ? <>
            {fixedReviewer ? <p className="text-sm">피드백 담당자 · {fixedReviewer.name} (업무를 배정한 사람)</p>
              : <label className="grid gap-2 text-sm">피드백 담당자
              <Select className="w-full" value={recipient} disabled={sending} onChange={event => setRecipient(event.currentTarget.value)}>
                <option value="">담당자 선택</option>
                {available.map(person => <option key={person.profileId} value={person.profileId}>
                  {formatChatPerson(person.displayName, person.position)}{person.departmentName ? ` · ${person.departmentName}` : ''}
                </option>)}
              </Select>
            </label>}
            <label className="grid gap-2 text-sm">함께 보낼 내용 (선택)
              <Textarea rows={3} maxLength={3600} className="py-2" value={note} disabled={sending}
                onChange={event => setNote(event.currentTarget.value)} />
            </label>
            <p className="text-xs text-muted-foreground">선택한 직원에게 피드백 요청 알림이 갑니다.</p>
          </> : <div className="space-y-2">
            <p className="text-sm text-muted-foreground">요청할 직원이 목록에 없습니다.</p>
            <Button type="button" size="sm" variant="outline" onClick={onSettings}>피드백 담당자 설정</Button>
          </div>}
        </>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <footer className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={sending} onClick={close}>취소</Button>
        <Button type="submit" disabled={!actorId || (needsDirectory && !directory.isSuccess) || sending || (!settings && !reviewerId)}>
          {settings ? '저장' : sending ? '보내는 중…' : '요청 보내기'}
        </Button>
      </footer>
    </form>
  </dialog>
}
