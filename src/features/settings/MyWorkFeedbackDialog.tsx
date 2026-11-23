import { useEffect, useId, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { ChatPeoplePicker } from '@/features/chat/ChatPeoplePicker'
import { chatKeys } from '@/features/chat/use-chat'
import { startWorkflow } from '@/lib/diagnostics/workflow-trace'
import { formatChatPerson } from '@/lib/inbox/format'
import type { ChatDirectoryPerson } from '@/lib/inbox/types'
import { listChatDirectory, openDirectChat, sendChatMessage } from '@/lib/supabase/chat'

export function MyWorkFeedbackDialog({ actorId, settings, cardTitle, recipientIds, onSettings, onSave, onSent, onClose }: {
  actorId?: string
  settings: boolean
  cardTitle?: string
  recipientIds: readonly string[]
  onSettings: () => void
  onSave: (ids: string[]) => void
  onSent: (person: ChatDirectoryPerson) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [savedSelection, setSavedSelection] = useState(() => new Set(recipientIds))
  const [search, setSearch] = useState('')
  const [recipient, setRecipient] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const attempt = useRef<{ id: string; recipient: string; body: string }>(null)
  const inFlight = useRef(false)
  const cache = useQueryClient()
  const directory = useQuery({
    queryKey: [...chatKeys.directory, actorId], queryFn: listChatDirectory, enabled: Boolean(actorId), retry: false,
  })
  const people = directory.data ?? []
  const available = people.filter(person => recipientIds.includes(person.profileId))
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

  async function requestFeedback() {
    const person = available.find(person => person.profileId === recipient)
    if (!person || !actorId || !cardTitle || inFlight.current || !directory.isSuccess) return
    const body = ['[내 업무 피드백 요청]', cardTitle, note.trim()].filter(Boolean).join('\n\n')
    const previous = attempt.current
    const id = previous?.recipient === recipient && previous.body === body ? previous.id : crypto.randomUUID()
    attempt.current = { id, recipient, body }
    inFlight.current = true
    setSending(true)
    setError('')
    const trace = startWorkflow('app', 'my_work_feedback_request')
    try {
      const roomId = await trace.run('open_direct_chat', () => openDirectChat(recipient))
      await trace.run('send_chat_message', () => sendChatMessage({ id, roomId, body }))
      void cache.invalidateQueries({ queryKey: chatKeys.rooms })
      void cache.invalidateQueries({ queryKey: chatKeys.messages(roomId, actorId) })
      trace.done()
      inFlight.current = false
      close()
      onSent(person)
    } catch {
      setError('요청을 보내지 못했습니다. 다시 시도해 주세요.')
    } finally {
      inFlight.current = false
      setSending(false)
    }
  }

  return <dialog ref={dialog} aria-labelledby={titleId}
    className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl backdrop:bg-black/25"
    onCancel={event => { event.preventDefault(); close() }}
    onClick={event => { if (event.target === event.currentTarget) close() }}>
    <form className="space-y-4" onSubmit={event => {
      event.preventDefault()
      if (!settings) { void requestFeedback(); return }
      if (actorId && directory.isSuccess) {
        if (!cardTitle) dialog.current?.close()
        onSave(people.filter(person => savedSelection.has(person.profileId)).map(person => person.profileId))
      }
    }}>
      <h2 id={titleId} className="text-lg font-semibold">{settings ? '피드백 담당자 설정' : '피드백 요청'}</h2>
      {!actorId ? <p className="text-sm text-muted-foreground">미리보기에서는 피드백 요청을 보낼 수 없습니다.</p>
        : directory.isPending ? <p role="status" className="text-sm text-muted-foreground">직원 목록을 불러오는 중입니다.</p>
        : directory.isError ? <div role="alert" className="space-y-2 text-sm text-danger">
          <p>직원 목록을 불러오지 못했습니다.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void directory.refetch()}>다시 불러오기</Button>
        </div> : settings ? <>
          <Input aria-label="직원 검색" placeholder="이름 또는 부서 검색" value={search} onChange={event => setSearch(event.currentTarget.value)} />
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
            <ChatPeoplePicker people={filtered} selectedIds={savedSelection} onToggle={id => setSavedSelection(current => {
              const next = new Set(current)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              return next
            })} />
          </div>
        </> : <>
          <p className="break-words text-sm font-medium">{cardTitle}</p>
          {available.length ? <>
            <label className="grid gap-2 text-sm">피드백 담당자
              <Select className="w-full" value={recipient} disabled={sending} onChange={event => setRecipient(event.currentTarget.value)}>
                <option value="">담당자 선택</option>
                {available.map(person => <option key={person.profileId} value={person.profileId}>
                  {formatChatPerson(person.displayName, person.position)}{person.departmentName ? ` · ${person.departmentName}` : ''}
                </option>)}
              </Select>
            </label>
            <label className="grid gap-2 text-sm">함께 보낼 내용 (선택)
              <Textarea rows={3} maxLength={3600} className="py-2" value={note} disabled={sending}
                onChange={event => setNote(event.currentTarget.value)} />
            </label>
            <p className="text-xs text-muted-foreground">업무 제목과 입력한 내용이 선택한 직원의 사내 채팅으로 전송됩니다.</p>
          </> : <div className="space-y-2">
            <p className="text-sm text-muted-foreground">요청할 직원이 목록에 없습니다.</p>
            <Button type="button" size="sm" variant="outline" onClick={onSettings}>피드백 담당자 설정</Button>
          </div>}
        </>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <footer className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={sending} onClick={close}>취소</Button>
        <Button type="submit" disabled={!actorId || !directory.isSuccess || sending ||
          (!settings && !available.some(person => person.profileId === recipient))}>
          {settings ? '저장' : sending ? '보내는 중…' : '요청 보내기'}
        </Button>
      </footer>
    </form>
  </dialog>
}
