import { chatDateKey, formatChatDateLabel } from '@/lib/inbox/format'
import type { ChatMessage } from '@/lib/inbox/types'

export type ChatThreadEntry =
  | { kind: 'date'; id: string; label: string }
  | { kind: 'message'; message: ChatMessage; showIdentity: boolean }

/** 날짜 구분선과, 같은 사람이 이어서 보낸 메시지에서 아바타를 숨길 표시. */
export function layoutChatThread(messages: readonly ChatMessage[]): ChatThreadEntry[] {
  const entries: ChatThreadEntry[] = []
  let lastDate = ''
  let streak = ''

  for (const message of messages) {
    const dateKey = chatDateKey(message.createdAt)
    if (dateKey !== lastDate) {
      if (dateKey) {
        entries.push({
          kind: 'date',
          id: `date-${dateKey}`,
          label: formatChatDateLabel(message.createdAt),
        })
      }
      lastDate = dateKey
      streak = ''
    }

    if (message.kind === 'system' || message.mine) {
      entries.push({ kind: 'message', message, showIdentity: false })
      streak = ''
      continue
    }

    const key = message.authorId ?? message.id
    entries.push({
      kind: 'message',
      message,
      showIdentity: key !== streak,
    })
    streak = key
  }

  return entries
}
