import { useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { layoutChatThread } from '@/lib/chat/thread-layout'
import type { ChatMessage, ChatRoom } from '@/lib/inbox/types'
import { markChatRoomRead } from '@/lib/supabase/chat'
import { emptyList } from '@/lib/utils'
import { ChatRoomAvatar } from './ChatAvatar'
import { ChatComposer, type ChatUploadItem } from './ChatComposer'
import { ChatMessageItem } from './ChatMessageItem'
import { chatKeys, useChatMessages } from './use-chat'
import type { OutgoingChatMessage } from './outgoing'

export function ChatThread({
  room,
  roomId,
  title,
  userId,
  myName,
  isManager,
  outgoing,
  titleId,
  onBack,
  onOpenInfo,
  onClose,
  onSend,
  onFiles,
  uploads,
  onRetry,
  onDelete,
  onAck,
}: {
  room: ChatRoom | null
  roomId: string
  title: string
  userId: string
  myName: string
  isManager: boolean
  outgoing: readonly OutgoingChatMessage[]
  titleId: string
  onBack?: () => void
  onOpenInfo: () => void
  onClose?: () => void
  onSend: (body: string) => void
  onFiles: (files: File[]) => void
  uploads: readonly ChatUploadItem[]
  onRetry: (messageId: string) => void
  onDelete: (messageId: string) => void
  onAck: (messageIds: ReadonlySet<string>) => void
}) {
  const queryClient = useQueryClient()
  const listRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const messagesQuery = useChatMessages(roomId, userId)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = messagesQuery
  const pages = messagesQuery.data?.pages ?? emptyList<ChatMessage[]>()

  const thread = useMemo(() => {
    const byId = new Map<string, ChatMessage>()
    for (const page of pages) {
      for (const message of page) byId.set(message.id, message)
    }
    for (const item of outgoing) {
      if (item.roomId !== roomId || byId.has(item.id)) continue
      byId.set(item.id, {
        id: item.id,
        roomId: item.roomId,
        authorId: userId,
        authorName: myName,
        kind: 'text',
        body: item.body,
        createdAt: item.createdAt,
        deletedAt: null,
        mine: true,
        pending: item.state === 'pending',
        failed: item.state === 'failed',
      })
    }
    return [...byId.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    )
  }, [myName, outgoing, pages, roomId, userId])

  const entries = useMemo(() => layoutChatThread(thread), [thread])
  const newestId = thread[thread.length - 1]?.id ?? ''

  useEffect(() => {
    const ids = new Set<string>()
    for (const page of pages) {
      for (const message of page) ids.add(message.id)
    }
    onAck(ids)
  }, [onAck, pages])

  useEffect(() => {
    const list = listRef.current
    if (!list || !stickRef.current) return
    list.scrollTop = list.scrollHeight
  }, [thread])

  useEffect(() => {
    const list = listRef.current
    if (!list || !hasNextPage || isFetchingNextPage) {
      return
    }
    if (list.scrollHeight > list.clientHeight + 8) return
    void fetchNextPage().catch((error: unknown) => {
      console.warn('[chat] 이전 메시지 조회 실패', {
        roomId,
        message: error instanceof Error ? error.message : String(error),
      })
    })
  }, [
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    roomId,
    thread.length,
  ])

  useEffect(() => {
    let cancelled = false
    async function mark() {
      if (document.visibilityState !== 'visible') return
      try {
        await markChatRoomRead(roomId)
        if (cancelled) return
        queryClient.setQueryData<ChatRoom[]>(chatKeys.rooms, (current) =>
          current?.map((item) =>
            item.id === roomId ? { ...item, unread: 0 } : item,
          ),
        )
      } catch (error) {
        console.warn('[chat] 읽음 처리 실패', {
          roomId,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    const timer = window.setTimeout(() => {
      void mark()
    }, 400)
    function onVisible() {
      if (document.visibilityState === 'visible') void mark()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [newestId, queryClient, roomId])

  function onScroll() {
    const list = listRef.current
    if (!list) return
    const distance = list.scrollHeight - list.scrollTop - list.clientHeight
    stickRef.current = distance < 80
    if (
      list.scrollTop < 40 &&
      messagesQuery.hasNextPage &&
      !messagesQuery.isFetchingNextPage
    ) {
      const previousHeight = list.scrollHeight
      void messagesQuery.fetchNextPage().then(() => {
        const next = listRef.current
        if (!next) return
        next.scrollTop = next.scrollHeight - previousHeight
      }).catch((error: unknown) => {
        console.warn('[chat] 이전 메시지 조회 실패', {
          roomId,
          message: error instanceof Error ? error.message : String(error),
        })
      })
    }
  }

  const errorText =
    messagesQuery.error instanceof Error
      ? messagesQuery.error.message
      : messagesQuery.error
        ? '메시지를 불러오지 못했습니다.'
        : null

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-2">
        {onBack ? (
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
        ) : null}
        {room ? <ChatRoomAvatar room={room} /> : (
          <span className="size-10 shrink-0 rounded-xl bg-muted" />
        )}
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-sm font-semibold"
          onClick={onOpenInfo}
        >
          <h2 id={titleId} className="truncate">
            {title}
          </h2>
        </button>
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
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="대화 정보"
            onClick={onOpenInfo}
          >
            <Menu className="size-3.5" />
          </Button>
        )}
      </header>

      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
        onScroll={onScroll}
      >
        {messagesQuery.isFetchingNextPage ? (
          <p className="text-center text-[11px] text-muted-foreground">
            이전 메시지를 불러오는 중입니다.
          </p>
        ) : null}
        {errorText ? (
          <p className="text-center text-sm text-danger">{errorText}</p>
        ) : null}
        {messagesQuery.isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            대화를 불러오는 중입니다.
          </p>
        ) : thread.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            아직 메시지가 없습니다.
          </p>
        ) : (
          entries.map((entry) =>
            entry.kind === 'date' ? (
              <div key={entry.id} className="flex justify-center py-1">
                <span className="rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">
                  {entry.label}
                </span>
              </div>
            ) : (
              <ChatMessageItem
                key={entry.message.id}
                message={entry.message}
                showIdentity={entry.showIdentity}
                canDelete={
                  !entry.message.deletedAt &&
                  entry.message.kind !== 'system' &&
                  (entry.message.mine || isManager)
                }
                onDelete={onDelete}
                onRetry={onRetry}
                onAttachmentChanged={() => {
                  void queryClient.invalidateQueries({
                    queryKey: chatKeys.messages(roomId, userId),
                  })
                  void queryClient.invalidateQueries({ queryKey: chatKeys.rooms })
                  void queryClient.invalidateQueries({ queryKey: chatKeys.usage })
                }}
              />
            ),
          )
        )}
      </div>
      <ChatComposer
        uploads={uploads}
        onFiles={(files) => {
          stickRef.current = true
          onFiles(files)
        }}
        onSend={(body) => {
          stickRef.current = true
          onSend(body)
        }}
      />
    </>
  )
}
