export type OutgoingChatMessage = {
  id: string
  roomId: string
  body: string
  createdAt: string
  state: 'pending' | 'failed'
}
