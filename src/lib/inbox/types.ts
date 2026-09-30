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

export type ChatRoomListMember = {
  profileId: string
  displayName: string
}

export type ChatRoom = {
  id: string
  kind: ChatRoomKind
  /** 그룹 방 이름. 1:1 방은 비어 있고 title을 보여 준다. */
  name: string
  title: string
  lastMessage: string
  lastAt: string | null
  unread: number
  peerProfileId: string | null
  /** 1:1 상대 이름. 직책은 빼 둔다. */
  peerName: string | null
  peerPosition: string | null
  /** 나를 뺀 멤버. 아바타와 이름 검색에 쓴다. */
  members: ChatRoomListMember[]
  lastKind: ChatMessageKind | null
  lastIsImage: boolean
  memberCount: number
}

export type ChatMessageKind = 'text' | 'file' | 'system'

export const CHAT_REACTION_EMOJIS = ['❤️', '👍', '✅', '😍', '😮', '😭'] as const
export type ChatReactionEmoji = (typeof CHAT_REACTION_EMOJIS)[number]

export type ChatReplyPreview = {
  id: string
  authorName: string
  kind: ChatMessageKind
  body: string
  deletedAt: string | null
}

export type ChatReaction = {
  profileId: string
  emoji: ChatReactionEmoji
}

export type ChatAttachmentStatus =
  | 'uploading'
  | 'ready'
  | 'trashed'
  | 'purged'
  | 'cancelled'

export type ChatAttachment = {
  id: string
  messageId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  hasMacro: boolean
  status: ChatAttachmentStatus
  objectPath: string
  /** 썸네일이 있으면 서명 주소를 만들 때 쓴다. */
  thumbPath: string | null
}

export type ChatMessage = {
  id: string
  roomId: string
  authorId: string | null
  authorName: string
  kind: ChatMessageKind
  body: string
  createdAt: string
  deletedAt: string | null
  replyToMessageId: string | null
  replyTo: ChatReplyPreview | null
  reactions: ChatReaction[]
  mine: boolean
  /** 서버 저장 전 표시. */
  pending?: boolean
  /** 저장에 실패하면 다시 보내기 버튼이 붙는다. */
  failed?: boolean
  attachment?: ChatAttachment | null
}

export type ChatDirectoryPerson = {
  profileId: string
  displayName: string
  departmentName: string | null
  position: string | null
}

export type ChatRoomMember = ChatDirectoryPerson & {
  joinedAt: string
}

export type ChatDownloadRecord = {
  profileId: string
  displayName: string
  downloadedAt: string
}
