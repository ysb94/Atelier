import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react'
import { Bell, MessageCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { inboxBadgeLabel } from '@/lib/inbox/format'
import {
  MOCK_CHAT_MESSAGES,
  MOCK_CHAT_ROOMS,
  MOCK_NOTIFICATIONS,
} from '@/lib/inbox/mock'
import type { ChatMessage, ChatRoom, InboxNotification } from '@/lib/inbox/types'
import { useAuth } from '@/lib/supabase/auth'
import { cn } from '@/lib/utils'
import { ChatPanel } from './ChatPanel'
import { NotificationPanel } from './NotificationPanel'

type OpenPanel = 'chat' | 'notifications'

function newMessageId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function WorkspaceHeaderActions() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const rootRef = useRef<HTMLDivElement>(null)
  const chatButtonRef = useRef<HTMLButtonElement>(null)
  const bellButtonRef = useRef<HTMLButtonElement>(null)
  const openedBy = useRef<OpenPanel | null>(null)
  const chatTitleId = useId()
  const notificationTitleId = useId()
  const [open, setOpen] = useState<OpenPanel | null>(null)
  const [notifications, setNotifications] = useState<InboxNotification[]>(
    () => MOCK_NOTIFICATIONS,
  )
  const [rooms, setRooms] = useState<ChatRoom[]>(() => MOCK_CHAT_ROOMS)
  const [messages, setMessages] = useState<ChatMessage[]>(
    () => MOCK_CHAT_MESSAGES,
  )

  const notificationCount = useMemo(
    () => notifications.filter((item) => !item.readAt).length,
    [notifications],
  )
  const chatCount = useMemo(
    () => rooms.reduce((sum, room) => sum + room.unread, 0),
    [rooms],
  )

  const closePanel = useCallback(() => {
    setOpen(null)
    const button =
      openedBy.current === 'chat'
        ? chatButtonRef.current
        : openedBy.current === 'notifications'
          ? bellButtonRef.current
          : null
    window.requestAnimationFrame(() => {
      button?.focus()
    })
  }, [])

  function toggle(next: OpenPanel) {
    openedBy.current = next
    setOpen((current) => (current === next ? null : next))
  }

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) closePanel()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closePanel()
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [closePanel, open])

  function markAllRead() {
    const readAt = new Date().toISOString()
    setNotifications((prev) =>
      prev.map((item) => (item.readAt ? item : { ...item, readAt })),
    )
  }

  function openNotification(item: InboxNotification) {
    const readAt = new Date().toISOString()
    setNotifications((prev) =>
      prev.map((current) =>
        current.id === item.id && !current.readAt
          ? { ...current, readAt }
          : current,
      ),
    )
    setOpen(null)
    navigate(item.href)
  }

  function openRoom(roomId: string) {
    setRooms((prev) =>
      prev.map((room) => (room.id === roomId ? { ...room, unread: 0 } : room)),
    )
  }

  function sendMessage(roomId: string, body: string) {
    const text = body.trim()
    if (!text) return
    const createdAt = new Date().toISOString()
    const message: ChatMessage = {
      id: newMessageId(),
      roomId,
      authorName: profile?.displayName || '나',
      body: text,
      createdAt,
      mine: true,
      pending: false,
    }
    setMessages((prev) => [...prev, message])
    setRooms((prev) =>
      prev.map((room) =>
        room.id === roomId
          ? { ...room, lastMessage: text, lastAt: createdAt }
          : room,
      ),
    )
  }

  return (
    <div
      ref={rootRef}
      className="relative flex shrink-0 items-center gap-0.5 px-1.5 pt-2"
    >
      <HeaderIconButton
        buttonRef={chatButtonRef}
        label={open === 'chat' ? '채팅 닫기' : '채팅'}
        pressed={open === 'chat'}
        badge={inboxBadgeLabel(chatCount)}
        controls={open === 'chat' ? 'workspace-chat-panel' : undefined}
        onClick={() => toggle('chat')}
      >
        <MessageCircle className="size-4" />
      </HeaderIconButton>
      <HeaderIconButton
        buttonRef={bellButtonRef}
        label={open === 'notifications' ? '알림 닫기' : '알림'}
        pressed={open === 'notifications'}
        badge={inboxBadgeLabel(notificationCount)}
        controls={
          open === 'notifications' ? 'workspace-notification-panel' : undefined
        }
        onClick={() => toggle('notifications')}
      >
        <Bell className="size-4" />
      </HeaderIconButton>

      {open === 'chat' ? (
        <div
          id="workspace-chat-panel"
          className="fixed top-12 right-3 bottom-24 z-30 flex w-[min(24rem,calc(100vw-1.5rem))] flex-col"
        >
          <ChatPanel
            rooms={rooms}
            messages={messages}
            titleId={chatTitleId}
            onOpenRoom={openRoom}
            onSend={sendMessage}
            onClose={closePanel}
          />
        </div>
      ) : null}
      {open === 'notifications' ? (
        <div
          id="workspace-notification-panel"
          className="fixed top-12 right-3 bottom-24 z-30 flex w-[min(24rem,calc(100vw-1.5rem))] flex-col"
        >
          <NotificationPanel
            items={notifications}
            titleId={notificationTitleId}
            onMarkAllRead={markAllRead}
            onOpen={openNotification}
            onClose={closePanel}
          />
        </div>
      ) : null}
    </div>
  )
}

function HeaderIconButton({
  buttonRef,
  label,
  pressed,
  badge,
  controls,
  onClick,
  children,
}: {
  buttonRef: Ref<HTMLButtonElement>
  label: string
  pressed: boolean
  badge: string | null
  controls?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={badge ? `${label}, ${badge}건` : label}
      aria-expanded={pressed}
      aria-haspopup="dialog"
      aria-controls={controls}
      title={label}
      onClick={onClick}
      className={cn(
        'relative inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground',
        pressed && 'bg-background text-foreground',
      )}
    >
      {children}
      {badge ? (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white">
          {badge}
        </span>
      ) : null}
    </button>
  )
}
