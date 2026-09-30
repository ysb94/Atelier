import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { ArrowLeft, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { formatInboxTime, inboxBadgeLabel } from '@/lib/inbox/format'
import type { ChatMessage, ChatRoom } from '@/lib/inbox/types'
import { cn } from '@/lib/utils'

function roomInitial(name: string) {
  return name.match(/[A-Za-z가-힣]/)?.[0] ?? name.slice(0, 1)
}

export function ChatPanel({
  rooms,
  messages,
  titleId,
  onOpenRoom,
  onSend,
  onClose,
}: {
  rooms: readonly ChatRoom[]
  messages: readonly ChatMessage[]
  titleId: string
  onOpenRoom: (roomId: string) => void
  onSend: (roomId: string, body: string) => void
  onClose: () => void
}) {
  const [roomId, setRoomId] = useState<string | null>(null)
  const room = rooms.find((item) => item.id === roomId) ?? null

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
    >
      {room ? (
        <ChatThread
          room={room}
          messages={messages}
          titleId={titleId}
          onBack={() => setRoomId(null)}
          onSend={onSend}
          onClose={onClose}
        />
      ) : (
        <ChatRoomList
          rooms={rooms}
          titleId={titleId}
          onOpen={(id) => {
            onOpenRoom(id)
            setRoomId(id)
          }}
          onClose={onClose}
        />
      )}
    </section>
  )
}

function ChatRoomList({
  rooms,
  titleId,
  onOpen,
  onClose,
}: {
  rooms: readonly ChatRoom[]
  titleId: string
  onOpen: (roomId: string) => void
  onClose: () => void
}) {
  const ordered = useMemo(
    () => [...rooms].sort((a, b) => b.lastAt.localeCompare(a.lastAt)),
    [rooms],
  )

  return (
    <>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <h2 id={titleId} className="text-sm font-medium">
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        {ordered.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            채팅방이 없습니다.
          </p>
        ) : (
          <ul>
            {ordered.map((room) => {
              const badge = inboxBadgeLabel(room.unread)
              return (
                <li key={room.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(room.id)}
                    className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                      {roomInitial(room.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          {room.name}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {formatInboxTime(room.lastAt)}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-muted-foreground">
                          {room.lastMessage}
                        </span>
                        {badge ? (
                          <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white">
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
    </>
  )
}

function ChatThread({
  room,
  messages,
  titleId,
  onBack,
  onSend,
  onClose,
}: {
  room: ChatRoom
  messages: readonly ChatMessage[]
  titleId: string
  onBack: () => void
  onSend: (roomId: string, body: string) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const thread = useMemo(
    () =>
      messages
        .filter((item) => item.roomId === room.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [messages, room.id],
  )

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    list.scrollTop = list.scrollHeight
  }, [thread])

  useEffect(() => {
    const timer = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(timer)
  }, [room.id])

  function send() {
    const text = draft.trim()
    if (!text) return
    onSend(room.id, text)
    setDraft('')
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
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
          {room.name}
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

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {thread.map((message) => (
          <div
            key={message.id}
            className={cn(
              'flex',
              message.mine ? 'justify-end' : 'justify-start',
            )}
          >
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap',
                message.mine
                  ? 'rounded-br-sm bg-primary text-primary-foreground'
                  : 'rounded-bl-sm bg-muted',
                message.pending && 'opacity-70',
              )}
            >
              {message.mine ? null : (
                <p className="mb-0.5 text-[11px] font-medium text-muted-foreground">
                  {message.authorName}
                </p>
              )}
              <p>{message.body}</p>
              <p
                className={cn(
                  'mt-1 text-[10px]',
                  message.mine
                    ? 'text-primary-foreground/70'
                    : 'text-muted-foreground',
                )}
              >
                {message.pending ? '보내는 중' : formatInboxTime(message.createdAt)}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-border p-3">
        <Textarea
          ref={inputRef}
          rows={2}
          value={draft}
          placeholder="메시지를 입력하세요."
          aria-label="메시지 입력"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            Enter 전송 · Shift+Enter 줄바꿈
          </p>
          <Button
            type="button"
            size="sm"
            disabled={!draft.trim()}
            onClick={send}
          >
            <Send className="size-3.5" />
            보내기
          </Button>
        </div>
      </div>
    </>
  )
}
