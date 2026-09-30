import { useState } from 'react'
import { formatChatClock } from '@/lib/inbox/format'
import type { ChatMessage } from '@/lib/inbox/types'
import { cn } from '@/lib/utils'
import { ChatAttachmentCard } from './ChatAttachmentCard'
import { ChatPersonAvatar } from './ChatAvatar'

export function ChatMessageItem({
  message,
  showIdentity,
  canDelete,
  onDelete,
  onRetry,
  onAttachmentChanged,
}: {
  message: ChatMessage
  showIdentity: boolean
  canDelete: boolean
  onDelete: (messageId: string) => void
  onRetry: (messageId: string) => void
  onAttachmentChanged?: () => void
}) {
  const [confirming, setConfirming] = useState(false)

  if (message.kind === 'system') {
    return (
      <p className="px-6 text-center text-[11px] text-muted-foreground">
        {message.deletedAt ? '삭제된 메시지' : message.body}
      </p>
    )
  }

  const deleted = Boolean(message.deletedAt)
  const file = message.kind === 'file'
  const status = (
    <MessageStatus message={message} onRetry={onRetry} />
  )

  const body = file ? (
    <div
      className={cn(
        'max-w-full rounded-xl border border-border bg-card p-2 text-foreground',
        message.pending && 'opacity-70',
      )}
    >
      <ChatAttachmentCard
        attachment={message.attachment}
        fileName={message.body}
        canModerate={canDelete && !message.pending && !message.failed}
        onChanged={onAttachmentChanged}
      />
    </div>
  ) : (
    <div
      className={cn(
        'max-w-full rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap',
        message.mine
          ? 'rounded-br-sm bg-primary text-primary-foreground'
          : 'rounded-bl-sm bg-muted',
        message.pending && 'opacity-70',
      )}
    >
      {deleted ? (
        <p className="italic opacity-80">삭제된 메시지</p>
      ) : message.body ? (
        <p>{message.body}</p>
      ) : null}
      {canDelete && !deleted && !message.pending && !message.failed ? (
        confirming ? (
          <span className="mt-1 flex gap-2 text-[11px]">
            <button type="button" className="underline" onClick={() => onDelete(message.id)}>
              삭제
            </button>
            <button type="button" className="underline" onClick={() => setConfirming(false)}>
              취소
            </button>
          </span>
        ) : (
          <button
            type="button"
            className={cn(
              'mt-1 text-[11px] underline',
              message.mine ? 'text-primary-foreground/80' : 'text-muted-foreground',
            )}
            onClick={() => setConfirming(true)}
          >
            삭제
          </button>
        )
      ) : null}
    </div>
  )

  const row = (
    <div className={cn('flex items-end gap-1.5', message.mine && 'flex-row')}>
      {message.mine ? status : null}
      <div className="min-w-0 max-w-[16rem]">{body}</div>
      {message.mine ? null : status}
    </div>
  )

  if (message.mine) {
    return <div className="flex justify-end">{row}</div>
  }

  return (
    <div className="flex items-start gap-2">
      {showIdentity ? (
        <ChatPersonAvatar
          profileId={message.authorId ?? message.id}
          name={message.authorName}
          className="size-8 text-[10px]"
        />
      ) : (
        <span className="size-8 shrink-0" />
      )}
      <div className="min-w-0">
        {showIdentity ? (
          <p className="mb-1 text-xs font-medium">{message.authorName}</p>
        ) : null}
        {row}
      </div>
    </div>
  )
}

function MessageStatus({
  message,
  onRetry,
}: {
  message: ChatMessage
  onRetry: (messageId: string) => void
}) {
  if (message.pending) {
    return <span className="shrink-0 text-[10px] text-muted-foreground">보내는 중</span>
  }
  if (message.failed) {
    return (
      <span className="shrink-0 text-right text-[10px] text-danger">
        보내지 못했습니다
        <button type="button" className="mt-0.5 block underline" onClick={() => onRetry(message.id)}>
          다시 보내기
        </button>
      </span>
    )
  }
  const clock = formatChatClock(message.createdAt)
  if (!clock) return null
  return <span className="shrink-0 text-[10px] text-muted-foreground">{clock}</span>
}
