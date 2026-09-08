import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { MessageCircle, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { formatDate, formatTime } from './work-request-schedule'
import {
  personLabel,
  type WorkRequestChatRoom,
  type WorkRequestMessage,
} from './work-request-types'

export function WorkRequestChat({
  requestId,
  rooms,
  messages,
  selfId,
  canWrite,
  onSend,
  className,
}: {
  requestId: string
  rooms: WorkRequestChatRoom[]
  messages: WorkRequestMessage[]
  selfId: string
  canWrite: boolean
  onSend: (body: string, roomId: string) => void
  className?: string
}) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(true)
  const [activeRoomId, setActiveRoomId] = useState(rooms[0]?.id ?? '')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setActiveRoomId(rooms[0]?.id ?? '')
    setOpen(true)
    setDraft('')
  }, [requestId])

  const activeRoom =
    rooms.find((room) => room.id === activeRoomId) ?? rooms[0] ?? null
  const roomMessages = activeRoom
    ? messages.filter((message) => message.roomId === activeRoom.id)
    : []

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    list.scrollTop = list.scrollHeight
  }, [roomMessages.length, activeRoom?.id])

  function submit() {
    const text = draft.trim()
    if (!text || !canWrite || !activeRoom) return
    onSend(text, activeRoom.id)
    setDraft('')
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const ordered = [...roomMessages].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  )

  if (rooms.length === 0) return null

  return (
    <div
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card',
        open && className,
      )}
    >
      <div className="flex shrink-0 items-stretch gap-1.5 overflow-x-auto border-b border-border bg-muted/40 px-2 pt-2">
        {rooms.map((room) => {
          const selected = open && room.id === activeRoom?.id
          return (
            <button
              key={room.id}
              type="button"
              className={cn(
                'group flex w-44 shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 py-1.5 text-sm transition-colors',
                selected
                  ? 'border-border bg-background text-foreground'
                  : 'border-border/80 bg-muted/70 text-muted-foreground hover:bg-background/70',
              )}
              onClick={() => {
                if (room.id === activeRoom?.id) {
                  setOpen((current) => !current)
                  return
                }
                setActiveRoomId(room.id)
                setOpen(true)
                setDraft('')
              }}
            >
              <MessageCircle className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2 text-[10px] leading-none text-muted-foreground">
                  <span>{room.roleLabel}</span>
                  <span className="truncate">{room.departmentLabel}</span>
                </span>
                <span className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="truncate">{room.peerName.trim() || '미입력'}</span>
                  {room.peerPosition.trim() ? (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {room.peerPosition}
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      {open && activeRoom ? (
        <>
          <div
            ref={listRef}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
          >
            {ordered.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                아직 대화가 없습니다. 부족한 내용을 먼저 물어보세요.
              </p>
            ) : (
              ordered.map((message, index) => {
                const previous = ordered[index - 1]
                const showDate =
                  !previous ||
                  formatDate(message.createdAt.slice(0, 10)) !==
                    formatDate(previous.createdAt.slice(0, 10))
                const mine = message.authorId === selfId
                return (
                  <div key={message.id}>
                    {showDate ? (
                      <p className="mb-3 text-center text-[11px] text-muted-foreground">
                        {formatDate(message.createdAt.slice(0, 10))}
                      </p>
                    ) : null}
                    <div
                      className={cn(
                        'flex flex-col gap-1',
                        mine ? 'items-end' : 'items-start',
                      )}
                    >
                      <p className="text-[11px] text-muted-foreground">
                        {personLabel(message.authorName, message.authorPosition)}{' '}
                        · {formatTime(message.createdAt)}
                      </p>
                      <div
                        className={cn(
                          'max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap',
                          mine
                            ? 'rounded-br-sm bg-primary text-primary-foreground'
                            : 'rounded-bl-sm bg-muted',
                        )}
                      >
                        {message.body}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
          {canWrite ? (
            <div className="border-t border-border p-3">
              <Textarea
                rows={2}
                value={draft}
                placeholder="메시지를 입력하고 Enter로 보내세요."
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
              />
              <div className="mt-2 flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  disabled={!draft.trim()}
                  onClick={submit}
                >
                  <Send className="size-3.5" />
                  보내기
                </Button>
              </div>
            </div>
          ) : (
            <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
              이 요청의 대화에 참여할 수 없습니다.
            </p>
          )}
        </>
      ) : null}
    </div>
  )
}
