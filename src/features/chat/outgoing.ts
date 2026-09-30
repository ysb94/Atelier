import type { ChatReplyPreview } from '@/lib/inbox/types'

export type OutgoingChatMessage = {
  id: string
  roomId: string
  body: string
  replyToMessageId: string | null
  replyTo: ChatReplyPreview | null
  createdAt: string
  state: 'pending' | 'failed'
}
