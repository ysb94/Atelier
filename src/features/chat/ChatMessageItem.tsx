import { useEffect, useRef, useState } from 'react'
import { Heart, MoreVertical, Reply, Trash2 } from 'lucide-react'
import { formatChatClock } from '@/lib/inbox/format'
import { CHAT_REACTION_EMOJIS, type ChatMessage, type ChatReactionEmoji } from '@/lib/inbox/types'
import { cn } from '@/lib/utils'
import { ChatAttachmentCard } from './ChatAttachmentCard'
import { ChatPersonAvatar } from './ChatAvatar'

export function ChatMessageItem({
  message, showIdentity, canDelete, userId, reactionBusy,
  onDelete, onReply, onReact, onRetry, onAttachmentChanged,
}: {
  message: ChatMessage
  showIdentity: boolean
  canDelete: boolean
  userId: string
  reactionBusy: boolean
  onDelete: (messageId: string) => void
  onReply: (message: ChatMessage) => void
  onReact: (message: ChatMessage, emoji: ChatReactionEmoji) => void
  onRetry: (messageId: string) => void
  onAttachmentChanged?: () => void
}) {
  const [openPanel, setOpenPanel] = useState<'menu' | 'reactions' | null>(null)
  const actionsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openPanel) return
    function closeOnOutside(event: PointerEvent) {
      if (!actionsRef.current?.contains(event.target as Node)) setOpenPanel(null)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpenPanel(null)
      }
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openPanel])

  if (message.kind === 'system') {
    return (
      <p className="px-6 text-center text-[11px] text-muted-foreground">
        {message.deletedAt ? '삭제된 메시지' : message.body}
      </p>
    )
  }

  const deleted = Boolean(message.deletedAt)
  const actionable = !deleted && !message.pending && !message.failed
  const ownReaction = message.reactions.find((reaction) => reaction.profileId === userId)?.emoji ?? null
  const reactions = CHAT_REACTION_EMOJIS.map((emoji) => ({
    emoji,
    count: message.reactions.filter((reaction) => reaction.emoji === emoji).length,
  })).filter((reaction) => reaction.count > 0)
  const status = <MessageStatus message={message} onRetry={onRetry} />

  const body = (
    <div className="min-w-0 max-w-[16rem]">
      <div className={cn(
        message.kind === 'file' && !deleted
          ? 'rounded-xl border border-border bg-card p-2 text-foreground'
          : 'rounded-2xl px-3 py-2 text-sm',
        message.kind !== 'file' && (message.mine
          ? 'rounded-br-sm bg-primary text-primary-foreground'
          : 'rounded-bl-sm bg-muted'),
        message.pending && 'opacity-70',
      )}>
        {!deleted && message.replyToMessageId ? (
          <div className={cn(
            'mb-2 min-w-0 border-l-2 pl-2 text-xs',
            message.mine && message.kind !== 'file'
              ? 'border-primary-foreground/70 text-primary-foreground/85'
              : 'border-primary/60 text-muted-foreground',
          )}>
            <p className="truncate font-semibold">{message.replyTo?.authorName ?? '이전 메시지'}</p>
            <p className="line-clamp-2 break-words">
              {!message.replyTo || message.replyTo.deletedAt
                ? '삭제된 메시지'
                : message.replyTo.kind === 'file'
                  ? `파일: ${message.replyTo.body}`
                  : message.replyTo.body}
            </p>
          </div>
        ) : null}
        {deleted ? (
          <p className="italic opacity-80">삭제된 메시지</p>
        ) : message.kind === 'file' ? (
          <ChatAttachmentCard
            attachment={message.attachment}
            fileName={message.body}
            canModerate={canDelete && actionable}
            onChanged={onAttachmentChanged}
          />
        ) : (
          <p className="whitespace-pre-wrap break-words">{message.body}</p>
        )}
      </div>
      {!deleted && reactions.length > 0 ? (
        <div className={cn('mt-1 flex flex-wrap gap-1', message.mine && 'justify-end')}>
          {reactions.map(({ emoji, count }) => (
            <button
              key={emoji}
              type="button"
              className={cn(
                'rounded-full border px-1.5 py-0.5 text-[11px] leading-none',
                ownReaction === emoji ? 'border-primary bg-primary/10' : 'border-border bg-card',
              )}
              aria-label={`${emoji} 반응 ${count}개${ownReaction === emoji ? ', 내 반응 취소' : ''}`}
              aria-pressed={ownReaction === emoji}
              disabled={!actionable || reactionBusy}
              onClick={() => onReact(message, emoji)}
            >
              {emoji}<span className="ml-1">{count}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )

  const actions = actionable ? (
    <div ref={actionsRef} className={cn(
      'relative z-10 flex shrink-0 items-center rounded-md border border-border bg-card shadow-sm',
      'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100',
      openPanel && 'opacity-100',
    )}>
      {canDelete ? (
        <button
          type="button"
          className="flex size-7 items-center justify-center border-r border-border hover:bg-muted"
          aria-label="메시지 더보기"
          aria-expanded={openPanel === 'menu'}
          onClick={() => setOpenPanel(openPanel === 'menu' ? null : 'menu')}
        >
          <MoreVertical className="size-3.5" />
        </button>
      ) : null}
      <button
        type="button"
        className="flex size-7 items-center justify-center border-r border-border hover:bg-muted"
        aria-label="반응 남기기"
        aria-expanded={openPanel === 'reactions'}
        onClick={() => setOpenPanel(openPanel === 'reactions' ? null : 'reactions')}
      >
        <Heart className={cn('size-3.5', ownReaction && 'fill-current text-rose-500')} />
      </button>
      <button
        type="button"
        className="flex size-7 items-center justify-center hover:bg-muted"
        aria-label="메시지에 답장"
        onClick={() => { setOpenPanel(null); onReply(message) }}
      >
        <Reply className="size-3.5" />
      </button>
      {openPanel === 'menu' ? (
        <div className={cn(
          'absolute bottom-full z-20 mb-1 min-w-24 rounded-md border border-border bg-card p-1 shadow-lg',
          message.mine ? 'right-0' : 'left-0',
        )}>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-danger hover:bg-muted"
            onClick={() => { setOpenPanel(null); onDelete(message.id) }}
          >
            <Trash2 className="size-3.5" />삭제
          </button>
        </div>
      ) : null}
      {openPanel === 'reactions' ? (
        <div className={cn(
          'absolute bottom-full z-20 mb-1 flex gap-0.5 rounded-full border border-border bg-card p-1 shadow-lg',
          message.mine ? 'right-0' : 'left-0',
        )}>
          {CHAT_REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="flex size-7 items-center justify-center rounded-full text-lg hover:bg-muted"
              aria-label={`${emoji} 반응`}
              aria-pressed={ownReaction === emoji}
              disabled={reactionBusy}
              onClick={() => { setOpenPanel(null); onReact(message, emoji) }}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  ) : null

  const row = (
    <div className="group flex min-w-0 items-end gap-1.5">
      {message.mine ? status : null}
      {message.mine ? actions : null}
      {body}
      {message.mine ? null : actions}
      {message.mine ? null : status}
    </div>
  )

  if (message.mine) return <div className="flex justify-end">{row}</div>

  return (
    <div className="flex items-start gap-2">
      {showIdentity ? (
        <ChatPersonAvatar
          profileId={message.authorId ?? message.id}
          name={message.authorName}
          className="size-8 text-[10px]"
        />
      ) : <span className="size-8 shrink-0" />}
      <div className="min-w-0">
        {showIdentity ? <p className="mb-1 text-xs font-medium">{message.authorName}</p> : null}
        {row}
      </div>
    </div>
  )
}

function MessageStatus({
  message, onRetry,
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
