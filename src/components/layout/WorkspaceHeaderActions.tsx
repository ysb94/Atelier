import { myHomeNotificationSummary } from '@/lib/inbox/my-home-notifications'
import { browserUnreadCount } from '@/lib/workspace/browser-title'
import { useBrowserTabIdentity } from './browser-identity-context'
import { useMyHomeNotifications } from '@/features/settings/use-my-home-notifications'
import {
  useCallback,
  useContext,
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
import { useNavigate, useSearchParams } from 'react-router-dom'
import { OPEN_CONVERSATION_EVENT, type RequestedConversation } from '@/lib/chat/open-conversation'
import { ChatPanel } from '@/features/chat/ChatPanel'
import { useChatRealtime } from '@/features/chat/use-chat-realtime'
import { useChatRooms } from '@/features/chat/use-chat'
import { hasPermission } from '@/lib/company/permissions'
import { useRenderWatch } from '@/lib/diagnostics/render-watch'
import { AttendanceStatusActions } from '@/features/home/AttendanceEntryGate'
import { inboxBadgeLabel } from '@/lib/inbox/format'
import type { ChatRoom, InboxNotification } from '@/lib/inbox/types'
import { useAuth } from '@/lib/supabase/auth'
import { PreviewContext, useHeaderPreview } from '@/lib/company/developer-preview-context'
import { cn, emptyList } from '@/lib/utils'
import { NotificationPanel } from './NotificationPanel'
import { DesktopNotificationSettings } from './DesktopNotificationSettings'
import { useDesktopNotifications } from '@/lib/inbox/use-desktop-notifications'
import { desktopBackgroundEnabled } from '@/lib/inbox/desktop-notifications'
import { DeveloperPreviewBar, DeveloperPreviewProvider } from './DeveloperPreview'
import { useWorkspaceOverlayHost } from './use-workspace-overlay-host'
import { ReleaseAccessProvider, useReleaseAccess } from './release-access-context'
import { useLeaveUsageNotices } from '@/features/operations-support/use-leave-usage-notices'
import { LeaveUsageNoticeReceiver } from '@/features/operations-support/LeaveUsageNoticeReceiver'
import { MaterialNudgeNotice } from '@/features/planning/MaterialNudgeDialog'

type OpenPanel = 'chat' | 'notifications'

// 페이지의 고정 헤더·서랍과 상단 탭의 stacking context 밖에서 공통 패널을 표시한다.
const HEADER_PANEL_CLASS = 'pointer-events-auto fixed top-12 right-3 bottom-24 z-[200] flex w-[min(24rem,calc(100vw-1.5rem))] flex-col'

export function WorkspaceHeaderActions() {
  return <ReleaseAccessProvider><ReleasedHeaderActions /></ReleaseAccessProvider>
}

function ReleasedHeaderActions() {
  useRenderWatch('WorkspaceHeaderActions')
  const navigate = useNavigate()
  const { profile, session } = useAuth()
  const preview = useContext(PreviewContext)
  const { href: releaseLink, approvals, materialNudgeAccountId: nudgeAccountId,
    materialNudgeNotifications, materialNudgeError, materialNudgeSupported, refreshMaterialNudges } = useReleaseAccess()
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
  const [nudgeDetail, setNudgeDetail] = useState<{ accountId: string; item: InboxNotification } | null>(null)
  const [requestedRoom,setRequestedRoom]=useState<RequestedConversation|null>(null)
  const homeNotices=useMyHomeNotifications({coordinator:true, background:!preview?.selected && desktopBackgroundEnabled(profile?.id)})
  const leaveNotices=useLeaveUsageNotices()
  const [noticeParams,setNoticeParams]=useSearchParams()
  const openLeaveNotice=useRef(leaveNotices.open);openLeaveNotice.current=leaveNotices.open
  const requestedLeave=noticeParams.get('leaveNotice')
  useEffect(()=>{
    if (!requestedLeave || !leaveNotices.records.some(row=>row.id===requestedLeave)) return
    void openLeaveNotice.current(requestedLeave)
    setNoticeParams(previous=>{const next=new URLSearchParams(previous);next.delete('leaveNotice');return next},{replace:true})
  },[requestedLeave,leaveNotices.records,setNoticeParams])
  const { container: overlayContainer, restoreFocus } = useWorkspaceOverlayHost(open !== null)
  const homeNotifications = useMemo(() => homeNotices.items.filter(item => releaseLink(item.href) !== null), [homeNotices.items,releaseLink])
  const notifications = useMemo(() => [...homeNotifications, ...materialNudgeNotifications]
    .sort((a,b) => b.createdAt.localeCompare(a.createdAt)), [homeNotifications, materialNudgeNotifications])
  const desktop = useDesktopNotifications(
    !preview?.selected && profile?.status === 'active' && session?.user.id === profile.id ? profile.id : undefined,
    homeNotifications,
    homeNotices.ready && !homeNotices.error && !approvals.loading && !approvals.error,
    openNotification,
  )
  useEffect(()=>{
    function receive(event:Event){
      const detail=(event as CustomEvent<RequestedConversation>).detail
      if(!chatEnabled || !detail || typeof detail.id!=='string') return
      openedBy.current='chat';setRequestedRoom(detail);setOpen('chat')
    }
    window.addEventListener(OPEN_CONVERSATION_EVENT,receive)
    return ()=>window.removeEventListener(OPEN_CONVERSATION_EVENT,receive)
  },[chatEnabled])
  useEffect(()=>{setRequestedRoom(null);setOpen(null);setNudgeDetail(null)},[profile?.id])

  const notificationCount = useMemo(
    () => notifications.filter((item) => item.current!==false&&!item.readAt).length,
    [notifications],
  )
  const chatCount = useMemo(
    () => rooms.reduce((sum, room) => sum + room.unread, 0),
    [rooms],
  )
  const browserCount = useMemo(() => browserUnreadCount(notifications, rooms), [notifications, rooms])
  useBrowserTabIdentity(
    session?.user.id === profile?.id && !preview?.selected ? profile?.id : undefined,
    browserCount,
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
    if (next === 'notifications' && open !== 'notifications' && nudgeAccountId && materialNudgeSupported) {
      void refreshMaterialNudges({ cancelRefetch: false })
    }
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

  function openNotification(item: InboxNotification) {
    if (item.kind === 'material_nudge') {
      if (!nudgeAccountId) return
      const target = item.href ? releaseLink(item.href) : null
      setOpen(null)
      if (target) {
        setNudgeDetail(null)
        navigate(target)
      } else {
        setNudgeDetail({ accountId: nudgeAccountId, item })
      }
      return
    }
    const href=releaseLink(item.href)
    if (!href) return
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
      className="relative mr-1.5 flex shrink-0 items-center gap-0.5 self-center px-0.5"
    >
      <AttendanceStatusActions />
      <LeaveUsageNoticeReceiver notices={leaveNotices}/>
      {nudgeDetail && nudgeDetail.accountId === nudgeAccountId &&
        <MaterialNudgeNotice key={nudgeDetail.item.id} item={nudgeDetail.item} accountId={nudgeDetail.accountId}
          onClose={() => {
            setNudgeDetail(null)
            window.requestAnimationFrame(() => restoreFocus(bellButtonRef.current))
          }} />}
      <KoreaHeaderClock />
      {desktop.prompt && open !== 'notifications' ? createPortal(
        <div className="fixed bottom-4 right-4 z-40 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <DesktopNotificationSettings controls={desktop} invitation />
        </div>, document.body,
      ) : null}
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
        badge={myHomeNotificationSummary(notifications).pending>0?`${inboxBadgeLabel(myHomeNotificationSummary(notifications).pending)}${notificationCount>0?' •':''}`:(notificationCount>0?'•':null)}
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
            desktopSettings={<DesktopNotificationSettings controls={desktop} />}
            items={notifications}
            titleId={notificationTitleId}
            onOpen={openNotification}
            onClose={closePanel}
          />
          {homeNotices.error || leaveNotices.error ? <p role="alert" className="rounded border border-danger bg-card p-2 text-xs text-danger">{leaveNotices.error ?? (homeNotices.error instanceof Error ? homeNotices.error.message : '알림을 불러오지 못했습니다.')}</p> : null}
          {materialNudgeError &&
            <p role="alert" className="rounded border border-danger bg-card p-2 text-xs text-danger">자재요청 조르기 알림을 불러오지 못했습니다.</p>}
        </div>, overlayContainer,
      ) : null}
    </div>
  )
}

function koreaClockLabel(date: Date) {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('month')}월 ${part('day')}일 (${part('weekday')}) ${part('dayPeriod')} ${part('hour')}:${part('minute')}`
}

function KoreaHeaderClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <time
      dateTime={now.toISOString()}
      className="inline-flex h-7 items-center rounded-full bg-primary px-2 text-sm font-medium whitespace-nowrap text-primary-foreground tabular-nums"
    >
      {koreaClockLabel(now)}
    </time>
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
