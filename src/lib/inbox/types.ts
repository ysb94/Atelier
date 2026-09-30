/** 나중에 알림 테이블로 옮길 모양. 지금은 목업만 쓴다. */
export type InboxNotificationKind =
  | 'barcode_request'
  | 'barcode_issued'
  | 'barcode_pending'
  | 'outbound_changed'
  | 'mention'

export type InboxNotification = {
  id: string
  kind: InboxNotificationKind
  title: string
  body: string
  href: string
  createdAt: string
  readAt: string | null
}

export type ChatRoomKind = 'direct' | 'group'

export type ChatRoom = {
  id: string
  name: string
  kind: ChatRoomKind
  lastMessage: string
  lastAt: string
  unread: number
}

export type ChatMessage = {
  id: string
  roomId: string
  authorName: string
  body: string
  createdAt: string
  mine: boolean
  /** 서버 저장 전 표시. 실패하면 재전송 버튼이 붙을 자리다. */
  pending?: boolean
}
