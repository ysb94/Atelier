import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type ComponentProps,
} from 'react'
import { createPortal } from 'react-dom'
import { Bell, MessageCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { OPEN_CONVERSATION_EVENT, type RequestedConversation } from '@/lib/chat/open-conversation'
import { readMeetingInvitation } from '@/lib/supabase/meetings'
import { ChatPanel } from '@/features/chat/ChatPanel'
import { useChatRealtime } from '@/features/chat/use-chat-realtime'
import { useChatRooms } from '@/features/chat/use-chat'
import { hasPermission } from '@/lib/company/permissions'
import { useRenderWatch } from '@/lib/diagnostics/render-watch'
import { AttendanceStatusActions } from '@/features/home/AttendanceEntryGate'
import { inboxBadgeLabel } from '@/lib/inbox/format'
import type { ChatRoom, InboxNotification } from '@/lib/inbox/types'
import { useAuth } from '@/lib/supabase/auth'
import { useHeaderPreview } from '@/lib/company/developer-preview-context'
import { cn, emptyList } from '@/lib/utils'
import { NotificationPanel } from './NotificationPanel'
import { useMeetingNotices } from '@/features/meetings/use-meeting-notices'
import { DeveloperPreviewBar, DeveloperPreviewProvider } from './DeveloperPreview'
import { useWorkspaceOverlayHost } from './use-workspace-overlay-host'
import { ReleaseAccessProvider, useReleaseAccess } from './release-access-context'
import { useLeaveUsageNotices } from '@/features/operations-support/use-leave-usage-notices'
import { leaveNoticeItems } from '@/features/operations-support/leave-usage-notices'
import { LeaveUsageNoticeReceiver } from '@/features/operations-support/LeaveUsageNoticeReceiver'

type OpenPanel = 'chat' | 'notifications'

// 페이지의 고정 헤더·서랍과 상단 탭의 stacking context 밖에서 공통 패널을 표시한다.
const HEADER_PANEL_CLASS = 'pointer-events-auto fixed top-12 right-3 bottom-24 z-[200] flex w-[min(24rem,calc(100vw-1.5rem))] flex-col'

export function WorkspaceHeaderActions() {
  return <ReleaseAccessProvider><ReleasedHeaderActions /></ReleaseAccessProvider>
}

function ReleasedHeaderActions() {
  useRenderWatch('WorkspaceHeaderActions')
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { href: releaseLink } = useReleaseAccess()
  const chatEnabled = profile?.status === 'active'
  const roomsQuery = useChatRooms(chatEnabled)
  useChatRealtime(chatEnabled)
  const rooms = roomsQuery.data ?? emptyList<ChatRoom>()
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const chatButtonRef = useRef<HTMLButtonElement>(null)
  const bellButtonRef = useRef<HTMLButtonElement>(null)
  const openedBy = useRef<OpenPanel | null>(null)
  const chatTitleId = useId()
  const notificationTitleId = useId()
  const [open, setOpen] = useState<OpenPanel | null>(null)
  const [requestedRoom,setRequestedRoom]=useState<RequestedConversation|null>(null)
  const cache=useQueryClient()
  const meetingNotices=useMeetingNotices()
  const leaveNotices=useLeaveUsageNotices()
  const [notificationError,setNotificationError]=useState<string|null>(null)
  const { container: overlayContainer, restoreFocus } = useWorkspaceOverlayHost(open !== null)
  const notifications = useMemo(() => [...meetingNotices.items.filter(item => releaseLink(item.href) !== null), ...leaveNoticeItems(leaveNotices.records)].sort((a,b) => b.createdAt.localeCompare(a.createdAt)), [meetingNotices.items, releaseLink, leaveNotices.records])
  useEffect(()=>{
    function receive(event:Event){
      const detail=(event as CustomEvent<RequestedConversation>).detail
      if(!chatEnabled || !detail || typeof detail.id!=='string') return
      openedBy.current='chat';setRequestedRoom(detail);setOpen('chat')
    }
    window.addEventListener(OPEN_CONVERSATION_EVENT,receive)
    return ()=>window.removeEventListener(OPEN_CONVERSATION_EVENT,receive)
  },[chatEnabled])
  useEffect(()=>{setRequestedRoom(null);setOpen(null)},[profile?.id])

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
    setRequestedRoom(null)
    const button =
      openedBy.current === 'chat'
        ? chatButtonRef.current
        : openedBy.current === 'notifications'
          ? bellButtonRef.current
          : null
    window.requestAnimationFrame(() => {
      restoreFocus(button)
    })
  }, [restoreFocus])

  function toggle(next: OpenPanel) {
    setRequestedRoom(null)
    openedBy.current = next
    setOpen((current) => (current === next ? null : next))
  }

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) closePanel()
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

  async function markMeetingRead(id:string|null) {
    try {await readMeetingInvitation(id);setNotificationError(null);await cache.invalidateQueries({queryKey:['meeting-invitations']})}
    catch(error){console.warn('[meetings] 참석 요청 읽음 처리 실패',{error});setNotificationError('참석 요청을 읽음으로 표시하지 못했습니다. 다시 시도해 주세요.')}
  }
  function markAllRead() {
    if(notifications.some(item=>item.kind==='meeting_invitation' && !item.readAt)) void markMeetingRead(null)
    if(notifications.some(item=>item.kind==='leave_usage_notice' && !item.readAt)) void leaveNotices.markAllRead()
  }

  function openNotification(item: InboxNotification) {
    if(item.kind==='leave_usage_notice') { setOpen(null);void leaveNotices.open(item.id);return }
    const href = releaseLink(item.href)
    if (!href) return
    if(item.kind==='meeting_invitation') void markMeetingRead(item.id)
    setOpen(null)
    navigate(href)
  }

  const roomsError =
    roomsQuery.error instanceof Error
      ? roomsQuery.error.message
      : roomsQuery.error
        ? '채팅방을 불러오지 못했습니다.'
        : null

  return (
    <div
      ref={rootRef}
      className="relative mr-10 flex shrink-0 items-center gap-0.5 px-1.5 pt-2"
    >
      <AttendanceStatusActions />
      <LeaveUsageNoticeReceiver notices={leaveNotices}/>
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

      {open === 'chat' && profile ? createPortal(
        <div
          ref={panelRef}
          id="workspace-chat-panel"
          className={HEADER_PANEL_CLASS}
        >
          <DeveloperPreviewProvider><ChatPanelPreview
            rooms={rooms}
            loading={roomsQuery.isLoading}
            error={roomsError}
            userId={profile.id}
            myName={profile.displayName?.trim() || '나'}
            isManager={hasPermission(profile, 'chat.moderate', 'company', profile.companyId)}
            canModerateRoom={roomId => hasPermission(profile, 'chat.moderate', 'chat_room', roomId)}
            isAdmin={hasPermission(profile, 'system.manage')}
            titleId={chatTitleId}
            onClose={closePanel}
            requestedRoom={requestedRoom}
          /></DeveloperPreviewProvider>
        </div>, overlayContainer,
      ) : null}
      {open === 'notifications' ? createPortal(
        <div
          ref={panelRef}
          id="workspace-notification-panel"
          className={HEADER_PANEL_CLASS}
        >
          <NotificationPanel
            items={notifications}
            titleId={notificationTitleId}
            onMarkAllRead={markAllRead}
            onOpen={openNotification}
            onClose={closePanel}
          />
          {notificationError || meetingNotices.error || leaveNotices.error ? <p role="alert" className="rounded border border-danger bg-card p-2 text-xs text-danger">{notificationError ?? leaveNotices.error ?? '회의 참석 요청을 불러오지 못했습니다.'}</p> : null}
        </div>, overlayContainer,
      ) : null}
    </div>
  )
}

function ChatPanelPreview(props: ComponentProps<typeof ChatPanel>) {
  const preview = useHeaderPreview()
  return <>
    <DeveloperPreviewBar scope="chat" />
    <div className="min-h-0 flex-1"><ChatPanel {...props}
      isManager={preview?.chatRole ? preview.chatRole !== 'employee' : props.isManager}
      canModerateRoom={preview?.chatRole ? undefined : props.canModerateRoom}
      isAdmin={preview?.chatRole ? preview.chatRole === 'all' : props.isAdmin}
    /></div>
  </>
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
