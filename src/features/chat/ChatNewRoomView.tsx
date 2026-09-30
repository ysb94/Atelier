import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ChatDirectoryPerson } from '@/lib/inbox/types'
import { createGroupChat, openDirectChat } from '@/lib/supabase/chat'
import { emptyList } from '@/lib/utils'
import { ChatPeoplePicker } from './ChatPeoplePicker'
import { chatKeys, useChatDirectory } from './use-chat'

function errorText(error: unknown) {
  return error instanceof Error ? error.message : '채팅방을 만들지 못했습니다.'
}

function defaultGroupName(people: readonly ChatDirectoryPerson[]) {
  const labels = people.slice(0, 3).map((person) => person.displayName)
  const suffix = people.length > 3 ? ` 외 ${people.length - 3}명` : ''
  return `${labels.join(', ')}${suffix}`.slice(0, 80)
}

export function ChatNewRoomView({
  titleId,
  onBack,
  onClose,
  onCreated,
}: {
  titleId: string
  onBack: () => void
  onClose: () => void
  onCreated: (roomId: string, title: string) => void
}) {
  const queryClient = useQueryClient()
  const directory = useChatDirectory(true)
  const people = directory.data ?? emptyList<ChatDirectoryPerson>()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [roomName, setRoomName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return people
    return people.filter((person) =>
      [person.displayName, person.departmentName, person.position]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(needle)),
    )
  }, [people, query])

  const selectedPeople = people.filter((person) => selected.has(person.profileId))
  const needsName = selectedPeople.length !== 1 && roomName.trim().length === 0 && selectedPeople.length === 0

  function toggle(profileId: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(profileId)) next.delete(profileId)
      else next.add(profileId)
      return next
    })
  }

  async function create() {
    if (pending) return
    setError(null)
    setPending(true)
    try {
      if (selectedPeople.length === 1) {
        const person = selectedPeople[0]
        if (!person) return
        const roomId = await openDirectChat(person.profileId)
        await queryClient.invalidateQueries({ queryKey: chatKeys.rooms })
        onCreated(roomId, person.displayName)
        return
      }
      const name = roomName.trim() || defaultGroupName(selectedPeople)
      if (!name) {
        setError('방 이름을 입력하세요.')
        return
      }
      const roomId = await createGroupChat(
        name,
        selectedPeople.map((person) => person.profileId),
      )
      await queryClient.invalidateQueries({ queryKey: chatKeys.rooms })
      onCreated(roomId, name)
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <header className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="채팅 목록"
          onClick={onBack}
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-medium">
          새 채팅
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="채팅 닫기"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </header>
      <div className="shrink-0 space-y-2 border-b border-border p-3">
        <Input
          value={query}
          placeholder="이름, 부서, 직책"
          aria-label="동료 검색"
          onChange={(event) => setQuery(event.target.value)}
        />
        {selectedPeople.length === 1 ? (
          <p className="text-[11px] text-muted-foreground">한 명을 고르면 1:1 대화가 열립니다.</p>
        ) : (
          <Input
            value={roomName}
            maxLength={80}
            placeholder={
              selectedPeople.length > 1
                ? defaultGroupName(selectedPeople)
                : '나만 쓰는 방 이름'
            }
            aria-label="방 이름"
            onChange={(event) => setRoomName(event.target.value)}
          />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {directory.isLoading ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            동료 명단을 불러오는 중입니다.
          </p>
        ) : directory.error ? (
          <p className="px-4 py-6 text-center text-sm text-danger">
            {errorText(directory.error)}
          </p>
        ) : (
          <ChatPeoplePicker
            people={filtered}
            selectedIds={selected}
            onToggle={toggle}
          />
        )}
      </div>
      <div className="shrink-0 border-t border-border p-3">
        {error ? <p className="mb-2 text-xs text-danger">{error}</p> : null}
        <Button
          type="button"
          className="w-full"
          disabled={pending || needsName}
          onClick={() => void create()}
        >
          {pending ? '만드는 중' : selectedPeople.length === 1 ? '대화 열기' : '방 만들기'}
        </Button>
      </div>
    </>
  )
}
