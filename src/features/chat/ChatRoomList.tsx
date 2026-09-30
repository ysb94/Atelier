import { useMemo, useState } from 'react'
import { Image as ImageIcon, Paperclip, Plus, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  CHAT_STORAGE_QUOTA_BYTES,
  formatChatBytes,
} from '@/lib/chat/file-rules'
import { formatChatListTime, inboxBadgeLabel } from '@/lib/inbox/format'
import type { ChatDirectoryPerson, ChatRoom } from '@/lib/inbox/types'
import { cn } from '@/lib/utils'
import { ChatRoomAvatar } from './ChatAvatar'
import { ChatContactList } from './ChatContactList'
import { useChatStorageUsage } from './use-chat'

export type ChatListTab = 'rooms' | 'contacts'

export function ChatRoomList({
  rooms,
  loading,
  error,
  titleId,
  isAdmin,
  tab,
  onTabChange,
  onOpen,
  onOpenContact,
  onNew,
  onClose,
}: {
  rooms: readonly ChatRoom[]
  loading: boolean
  error: string | null
  titleId: string
  isAdmin: boolean
  tab: ChatListTab
  onTabChange: (tab: ChatListTab) => void
  onOpen: (room: ChatRoom) => void
  onOpenContact: (person: ChatDirectoryPerson) => Promise<void>
  onNew: () => void
  onClose: () => void
}) {
  const [roomQuery, setRoomQuery] = useState('')
  const [contactQuery, setContactQuery] = useState('')
  const query = tab === 'rooms' ? roomQuery : contactQuery

  const filteredRooms = useMemo(() => {
    const needle = roomQuery.trim().toLowerCase()
    if (!needle) return rooms
    return rooms.filter((room) =>
      [
        room.title,
        room.name,
        room.peerName,
        room.peerPosition,
        ...room.members.map((member) => member.displayName),
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(needle)),
    )
  }, [roomQuery, rooms])

  return (
    <>
      <header className="flex shrink-0 items-center justify-between gap-2 px-3 pt-3 pb-1">
        <h2 id={titleId} className="text-base font-semibold">
          채팅
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

      <div className="flex shrink-0 items-end justify-between gap-2 px-3">
        <div role="tablist" aria-label="채팅 목록" className="flex gap-4">
          <ListTab
            selected={tab === 'rooms'}
            onClick={() => onTabChange('rooms')}
          >
            채팅
          </ListTab>
          <ListTab
            selected={tab === 'contacts'}
            onClick={() => onTabChange('contacts')}
          >
            연락처
          </ListTab>
        </div>
        <Button type="button" size="sm" className="mb-1.5" onClick={onNew}>
          <Plus className="size-3.5" />
          새 채팅
        </Button>
      </div>

      <div className="shrink-0 px-3 py-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            placeholder={
              tab === 'rooms' ? '이름, 채팅방명 검색' : '이름, 부서, 직책 검색'
            }
            aria-label={tab === 'rooms' ? '채팅방 검색' : '연락처 검색'}
            className="pl-8"
            onChange={(event) => {
              const next = event.target.value
              if (tab === 'rooms') setRoomQuery(next)
              else setContactQuery(next)
            }}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" role="tabpanel">
        {tab === 'contacts' ? (
          <ChatContactList query={contactQuery} onOpen={onOpenContact} />
        ) : error ? (
          <p className="px-4 py-6 text-center text-sm text-danger">{error}</p>
        ) : loading ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            채팅방을 불러오는 중입니다.
          </p>
        ) : rooms.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            채팅방이 없습니다. 새 채팅으로 대화를 시작하세요.
          </p>
        ) : filteredRooms.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            검색 결과가 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {filteredRooms.map((room) => {
              const badge = inboxBadgeLabel(room.unread)
              return (
                <li key={room.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(room)}
                    className={cn(
                      'flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted',
                      room.unread > 0 && 'bg-primary/5',
                    )}
                  >
                    <ChatRoomAvatar room={room} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <RoomTitle room={room} />
                        <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">
                          {room.lastAt ? formatChatListTime(room.lastAt) : ''}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-start justify-between gap-2">
                        <RoomPreview room={room} />
                        {badge ? (
                          <span className="mt-0.5 flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white">
                            {badge}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {isAdmin ? <ChatStorageUsage /> : null}
    </>
  )
}

function ListTab({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        'border-b-2 py-2 text-sm font-medium',
        selected
          ? 'border-foreground text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function RoomTitle({ room }: { room: ChatRoom }) {
  if (room.kind === 'direct') {
    return (
      <span className="min-w-0 truncate text-sm">
        <span className="font-semibold">{room.peerName || '이름 없음'}</span>
        {room.peerPosition ? (
          <span className="ml-1 font-normal text-muted-foreground">
            {room.peerPosition}
          </span>
        ) : null}
      </span>
    )
  }
  return (
    <span className="min-w-0 truncate text-sm">
      <span className="font-semibold">{room.name || '이름 없는 방'}</span>
      <span className="ml-1 font-normal text-muted-foreground">
        ({room.memberCount})
      </span>
    </span>
  )
}

function RoomPreview({ room }: { room: ChatRoom }) {
  const text = room.lastMessage.trim()
  if (room.lastKind === 'file' && text === '삭제된 파일') {
    return (
      <span className="line-clamp-2 text-sm text-muted-foreground">삭제된 파일</span>
    )
  }
  if (room.lastKind === 'file' && room.lastIsImage) {
    return (
      <span className="flex items-center gap-1 text-sm text-muted-foreground">
        <ImageIcon className="size-3.5 shrink-0" aria-hidden />
        (이미지)
      </span>
    )
  }
  if (room.lastKind === 'file') {
    return (
      <span className="flex min-w-0 items-start gap-1 text-sm text-muted-foreground">
        <Paperclip className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span className="line-clamp-2">{text || '파일'}</span>
      </span>
    )
  }
  return (
    <span className="line-clamp-2 text-sm text-muted-foreground">
      {text || '아직 메시지가 없습니다.'}
    </span>
  )
}

function ChatStorageUsage() {
  const query = useChatStorageUsage(true)
  return (
    <p className="shrink-0 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
      {query.isLoading
        ? '파일 사용량을 확인하는 중입니다.'
        : query.isError
          ? '파일 사용량을 불러오지 못했습니다.'
          : `파일 사용량 ${formatChatBytes(query.data?.usedBytes ?? 0)} / ${formatChatBytes(CHAT_STORAGE_QUOTA_BYTES)}`}
    </p>
  )
}
