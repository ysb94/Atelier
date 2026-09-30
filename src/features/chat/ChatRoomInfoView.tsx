import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatChatPerson } from '@/lib/inbox/format'
import type { ChatDirectoryPerson, ChatRoom, ChatRoomMember } from '@/lib/inbox/types'
import {
  addChatRoomMembers,
  leaveChatRoom,
  renameChatRoom,
} from '@/lib/supabase/chat'
import { emptyList } from '@/lib/utils'
import { ChatPeoplePicker } from './ChatPeoplePicker'
import { chatKeys, useChatDirectory, useChatMembers } from './use-chat'

function errorText(error: unknown) {
  return error instanceof Error ? error.message : '채팅방 정보를 바꾸지 못했습니다.'
}

export function ChatRoomInfoView({
  room,
  titleId,
  onBack,
  onClose,
  onLeft,
}: {
  room: ChatRoom
  titleId: string
  onBack: () => void
  onClose?: () => void
  onLeft: () => void
}) {
  const queryClient = useQueryClient()
  const membersQuery = useChatMembers(room.id, true)
  const directory = useChatDirectory(room.kind === 'group')
  const members = membersQuery.data ?? emptyList<ChatRoomMember>()
  const people = directory.data ?? emptyList<ChatDirectoryPerson>()
  const [name, setName] = useState(room.name)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const memberIds = useMemo(
    () => new Set(members.map((member) => member.profileId)),
    [members],
  )
  const invitees = useMemo(() => {
    const available = people.filter((person) => !memberIds.has(person.profileId))
    const needle = query.trim().toLowerCase()
    if (!needle) return available
    return available.filter((person) =>
      [person.displayName, person.departmentName, person.position]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(needle)),
    )
  }, [memberIds, people, query])

  async function saveName() {
    const next = name.trim()
    if (!next || next === room.name) return
    setPending(true)
    setError(null)
    try {
      await renameChatRoom(room.id, next)
      await queryClient.invalidateQueries({ queryKey: chatKeys.rooms })
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setPending(false)
    }
  }

  async function invite() {
    const ids = [...selected]
    if (ids.length === 0) return
    setPending(true)
    setError(null)
    try {
      await addChatRoomMembers(room.id, ids)
      setSelected(new Set())
      await queryClient.invalidateQueries({ queryKey: chatKeys.members(room.id) })
      await queryClient.invalidateQueries({ queryKey: chatKeys.rooms })
      await queryClient.invalidateQueries({
        queryKey: ['chat', 'messages', room.id],
      })
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setPending(false)
    }
  }

  async function leave() {
    setPending(true)
    setError(null)
    try {
      await leaveChatRoom(room.id)
      await queryClient.invalidateQueries({ queryKey: chatKeys.rooms })
      onLeft()
    } catch (caught) {
      setError(errorText(caught))
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
          aria-label="대화로 돌아가기"
          onClick={onBack}
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-medium">
          대화 정보
        </h2>
        {onClose ? (
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
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {room.kind === 'group' ? (
          <div className="space-y-2 border-b border-border p-3">
            <label className="block text-xs text-muted-foreground" htmlFor="chat-room-name">
              방 이름
            </label>
            <div className="flex gap-2">
              <Input
                id="chat-room-name"
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
              />
              <Button
                type="button"
                size="sm"
                disabled={pending || name.trim().length === 0 || name.trim() === room.name}
                onClick={() => void saveName()}
              >
                저장
              </Button>
            </div>
          </div>
        ) : (
          <p className="border-b border-border px-3 py-3 text-sm text-muted-foreground">
            1:1 대화는 이름을 바꾸거나 나갈 수 없습니다.
          </p>
        )}

        <p className="px-3 pt-3 text-xs text-muted-foreground">멤버 {members.length}명</p>
        {membersQuery.error ? (
          <p className="px-3 py-2 text-sm text-danger">{errorText(membersQuery.error)}</p>
        ) : (
          <ul className="border-b border-border py-1">
            {members.map((member) => (
              <li key={member.profileId} className="px-3 py-2">
                <p className="truncate text-sm">
                  {formatChatPerson(member.displayName, member.position)}
                </p>
                {member.departmentName ? (
                  <p className="truncate text-xs text-muted-foreground">
                    {member.departmentName}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {room.kind === 'group' ? (
          <div className="py-2">
            <p className="px-3 py-2 text-xs text-muted-foreground">초대</p>
            <div className="px-3 pb-2">
              <Input
                value={query}
                placeholder="이름, 부서, 직책"
                aria-label="초대할 동료 검색"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <ChatPeoplePicker
              people={invitees}
              selectedIds={selected}
              onToggle={(profileId) => {
                setSelected((current) => {
                  const next = new Set(current)
                  if (next.has(profileId)) next.delete(profileId)
                  else next.add(profileId)
                  return next
                })
              }}
            />
            <div className="px-3 pt-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={pending || selected.size === 0}
                onClick={() => void invite()}
              >
                선택한 사람 초대
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="shrink-0 border-t border-border p-3">
        {error ? <p className="mb-2 text-xs text-danger">{error}</p> : null}
        {room.kind === 'group' ? (
          confirmLeave ? (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="danger"
                className="flex-1"
                disabled={pending}
                onClick={() => void leave()}
              >
                나가기
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={pending}
                onClick={() => setConfirmLeave(false)}
              >
                취소
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setConfirmLeave(true)}
            >
              대화방 나가기
            </Button>
          )
        ) : null}
      </div>
    </>
  )
}
