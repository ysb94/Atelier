import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { canUseChatWindows, openChatWindow } from '@/lib/chat/chat-window'
import { formatChatPerson } from '@/lib/inbox/format'
import type { ChatDirectoryPerson, ChatRoom } from '@/lib/inbox/types'
import { openDirectChat } from '@/lib/supabase/chat'
import { ChatNewRoomView } from './ChatNewRoomView'
import { ChatRoomInfoView } from './ChatRoomInfoView'
import { ChatRoomList, type ChatListTab } from './ChatRoomList'
import { ChatThread } from './ChatThread'
import { chatKeys } from './use-chat'
import { useChatSending } from './use-chat-sending'

type ChatView =
  | { kind: 'list' }
  | { kind: 'new' }
  | { kind: 'thread'; roomId: string; fallbackTitle: string }
  | { kind: 'info'; roomId: string; fallbackTitle: string }

export function ChatPanel({
  rooms,
  loading,
  error,
  userId,
  myName,
  isManager,
  isAdmin,
  titleId,
  onClose,
}: {
  rooms: readonly ChatRoom[]
  loading: boolean
  error: string | null
  userId: string
  myName: string
  isManager: boolean
  isAdmin: boolean
  titleId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const sending = useChatSending(userId)
  const [view, setView] = useState<ChatView>({ kind: 'list' })
  const [listTab, setListTab] = useState<ChatListTab>('rooms')
  const [popupNotice, setPopupNotice] = useState<string | null>(null)

  const activeId =
    view.kind === 'thread' || view.kind === 'info' ? view.roomId : null
  const activeRoom = rooms.find((room) => room.id === activeId) ?? null
  const fallbackTitle =
    view.kind === 'thread' || view.kind === 'info' ? view.fallbackTitle : ''
  const title = activeRoom?.title || fallbackTitle || '채팅'

  function openInPanel(roomId: string, fallback: string) {
    setView({ kind: 'thread', roomId, fallbackTitle: fallback })
  }

  function openConversation(roomId: string, fallback: string) {
    setPopupNotice(null)
    sending.setActionError(null)
    if (canUseChatWindows()) {
      if (openChatWindow(roomId)) {
        setView({ kind: 'list' })
        return
      }
      setPopupNotice(
        '브라우저가 채팅 창을 막았습니다. 팝업을 허용한 뒤 다시 열어 주세요.',
      )
    }
    openInPanel(roomId, fallback)
  }

  function openRoom(room: ChatRoom) {
    openConversation(room.id, room.title)
  }

  async function openContact(person: ChatDirectoryPerson) {
    const roomId = await openDirectChat(person.profileId)
    await queryClient.invalidateQueries({ queryKey: chatKeys.rooms })
    openConversation(roomId, formatChatPerson(person.displayName, person.position))
  }

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
    >
      {view.kind === 'new' ? (
        <ChatNewRoomView
          titleId={titleId}
          onBack={() => setView({ kind: 'list' })}
          onClose={onClose}
          onCreated={(roomId, createdTitle) => openConversation(roomId, createdTitle)}
        />
      ) : view.kind === 'info' && activeRoom ? (
        <ChatRoomInfoView
          room={activeRoom}
          titleId={titleId}
          onBack={() =>
            setView({
              kind: 'thread',
              roomId: activeRoom.id,
              fallbackTitle: activeRoom.title,
            })
          }
          onClose={onClose}
          onLeft={() => setView({ kind: 'list' })}
        />
      ) : view.kind === 'thread' ? (
        <>
          {popupNotice ? (
            <p className="shrink-0 px-3 pt-2 text-xs text-danger">{popupNotice}</p>
          ) : null}
          {sending.actionError ? (
            <p className="shrink-0 px-3 pt-2 text-xs text-danger">{sending.actionError}</p>
          ) : null}
          <ChatThread
            room={activeRoom}
            roomId={view.roomId}
            title={title}
            userId={userId}
            myName={myName}
            isManager={isManager}
            outgoing={sending.outgoing}
            titleId={titleId}
            onBack={() => setView({ kind: 'list' })}
            onOpenInfo={() =>
              setView({
                kind: 'info',
                roomId: view.roomId,
                fallbackTitle: title,
              })
            }
            onClose={onClose}
            onSend={(body, replyTo) => sending.send(view.roomId, body, replyTo)}
            onFiles={(files) => sending.sendFiles(view.roomId, files)}
            uploads={sending.uploads.filter((item) => item.roomId === view.roomId)}
            onRetry={sending.retry}
            onDelete={(messageId) => void sending.remove(view.roomId, messageId)}
            onAck={sending.ack}
          />
        </>
      ) : (
        <ChatRoomList
          rooms={rooms}
          loading={loading}
          error={error}
          titleId={titleId}
          isAdmin={isAdmin}
          tab={listTab}
          onTabChange={setListTab}
          onOpen={openRoom}
          onOpenContact={openContact}
          onNew={() => {
            setPopupNotice(null)
            setView({ kind: 'new' })
          }}
          onClose={onClose}
        />
      )}
    </section>
  )
}
