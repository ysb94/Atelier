import { useEffect, useId, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { isCompanyManagerPosition } from '@/lib/company/capabilities'
import { useRenderWatch } from '@/lib/diagnostics'
import type { ChatRoom } from '@/lib/inbox/types'
import { useAuth } from '@/lib/supabase/auth'
import { emptyList } from '@/lib/utils'
import { ChatRoomInfoView } from './ChatRoomInfoView'
import { ChatThread } from './ChatThread'
import { useChatRealtime } from './use-chat-realtime'
import { useChatRooms } from './use-chat'
import { useChatSending } from './use-chat-sending'

export function ChatWindowPage() {
  useRenderWatch('ChatWindowPage')
  const { roomId = '' } = useParams()
  const titleId = useId()
  const { profile } = useAuth()
  const enabled = profile?.status === 'active'
  useChatRealtime(enabled)
  const roomsQuery = useChatRooms(enabled)
  const rooms = roomsQuery.data ?? emptyList<ChatRoom>()
  const room = rooms.find((item) => item.id === roomId) ?? null
  const userId = profile?.id ?? ''
  const sending = useChatSending(userId)
  const [info, setInfo] = useState(false)
  const uploading = sending.uploads.some((item) => item.roomId === roomId && !item.error)

  useEffect(() => {
    document.title = room ? `${room.title} - 채팅` : '채팅'
  }, [room])

  useEffect(() => {
    if (!uploading) return
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [uploading])

  const roomsError =
    roomsQuery.error instanceof Error
      ? roomsQuery.error.message
      : roomsQuery.error
        ? '채팅방을 불러오지 못했습니다.'
        : null

  if (!profile) return null

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {roomsQuery.isLoading ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          대화를 불러오는 중입니다.
        </p>
      ) : roomsError ? (
        <p className="px-4 py-10 text-center text-sm text-danger">{roomsError}</p>
      ) : !room ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-muted-foreground">
            이 채팅방에 참여하고 있지 않습니다.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => window.close()}>
            창 닫기
          </Button>
        </div>
      ) : info ? (
        <ChatRoomInfoView
          room={room}
          titleId={titleId}
          onBack={() => setInfo(false)}
          onLeft={() => window.close()}
        />
      ) : (
        <>
          {sending.actionError ? (
            <p className="shrink-0 px-3 pt-2 text-xs text-danger">{sending.actionError}</p>
          ) : null}
          <ChatThread
            room={room}
            roomId={room.id}
            title={room.title}
            userId={userId}
            myName={profile.displayName?.trim() || '나'}
            isManager={isCompanyManagerPosition(profile.position)}
            outgoing={sending.outgoing}
            titleId={titleId}
            onOpenInfo={() => setInfo(true)}
            onSend={(body) => sending.send(room.id, body)}
            onFiles={(files) => sending.sendFiles(room.id, files)}
            uploads={sending.uploads.filter((item) => item.roomId === room.id)}
            onRetry={sending.retry}
            onDelete={(messageId) => void sending.remove(room.id, messageId)}
            onAck={sending.ack}
          />
        </>
      )}
    </div>
  )
}
