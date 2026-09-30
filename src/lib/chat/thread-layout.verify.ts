/**
 * 대화 묶음. 날짜 구분과 이어서 보낸 메시지의 아바타.
 * 실행: npx tsx --tsconfig tsconfig.app.json src/lib/chat/thread-layout.verify.ts
 */
import type { ChatMessage } from '@/lib/inbox/types'
import { layoutChatThread } from './thread-layout'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function message(patch: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'createdAt'>): ChatMessage {
  return {
    roomId: 'room',
    authorId: 'other',
    authorName: '김지선',
    kind: 'text',
    body: '안녕',
    deletedAt: null,
    mine: false,
    ...patch,
  }
}

const entries = layoutChatThread([
  message({ id: 'a1', createdAt: '2026-09-29T03:00:00.000Z' }),
  message({ id: 'a2', createdAt: '2026-09-29T03:01:00.000Z' }),
  message({ id: 'mine', createdAt: '2026-09-29T03:02:00.000Z', mine: true, authorId: 'me' }),
  message({ id: 'a3', createdAt: '2026-09-29T03:03:00.000Z' }),
  message({
    id: 'sys',
    createdAt: '2026-09-29T03:04:00.000Z',
    kind: 'system',
    authorId: null,
    mine: false,
  }),
  message({ id: 'a4', createdAt: '2026-09-29T03:05:00.000Z' }),
  message({ id: 'b1', createdAt: '2026-09-30T01:00:00.000Z', authorId: 'peer-2', authorName: '윤설빈' }),
])

assert(entries[0]?.kind === 'date' && entries[0].label === '2026-09-29 (화)', '첫 날짜')
assert(
  entries[1]?.kind === 'message' && entries[1].showIdentity && entries[1].message.id === 'a1',
  '첫 메시지는 아바타',
)
assert(
  entries[2]?.kind === 'message' && !entries[2].showIdentity && entries[2].message.id === 'a2',
  '이어서 보낸 메시지는 아바타 없음',
)
assert(entries[3]?.kind === 'message' && entries[3].message.id === 'mine', '내 메시지')
assert(
  entries[4]?.kind === 'message' && entries[4].showIdentity && entries[4].message.id === 'a3',
  '내 메시지 다음엔 다시 아바타',
)
assert(entries[5]?.kind === 'message' && entries[5].message.kind === 'system', '시스템')
assert(
  entries[6]?.kind === 'message' && entries[6].showIdentity && entries[6].message.id === 'a4',
  '시스템 다음엔 다시 아바타',
)
assert(entries[7]?.kind === 'date' && entries[7].label === '2026-09-30 (수)', '날짜가 바뀌면 구분')
assert(
  entries[8]?.kind === 'message' && entries[8].showIdentity && entries[8].message.id === 'b1',
  '다음 날 첫 메시지',
)

console.log('thread-layout.verify ok')
