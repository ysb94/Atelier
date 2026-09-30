import { personInitials } from '@/lib/company/person-name'
import { chatAvatarTone } from '@/lib/chat/avatar-tone'
import type { ChatRoom } from '@/lib/inbox/types'
import { cn } from '@/lib/utils'

export function ChatPersonAvatar({
  profileId,
  name,
  className,
}: {
  profileId: string
  name: string
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-xl text-xs font-semibold',
        chatAvatarTone(profileId),
        className,
      )}
    >
      {personInitials(name)}
    </span>
  )
}

export function ChatRoomAvatar({ room }: { room: ChatRoom }) {
  if (room.kind === 'direct') {
    return (
      <ChatPersonAvatar
        profileId={room.peerProfileId ?? room.id}
        name={room.peerName || '이름 없음'}
      />
    )
  }

  const faces = room.members.slice(0, 4)
  if (faces.length === 0) {
    const letter = room.name.trim().slice(0, 1) || '?'
    return (
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-semibold text-muted-foreground"
      >
        {letter}
      </span>
    )
  }

  if (faces.length === 1) {
    const face = faces[0]
    if (!face) return null
    return <ChatPersonAvatar profileId={face.profileId} name={face.displayName} />
  }

  return (
    <span
      aria-hidden
      className="grid size-10 shrink-0 grid-cols-2 gap-px overflow-hidden rounded-xl bg-border"
    >
      {Array.from({ length: 4 }, (_, index) => {
        const face = faces[index]
        if (!face) return <span key={index} className="bg-muted" />
        return (
          <span
            key={face.profileId}
            className={cn(
              'flex items-center justify-center text-[8px] font-semibold leading-none',
              chatAvatarTone(face.profileId),
            )}
          >
            {personInitials(face.displayName)}
          </span>
        )
      })}
    </span>
  )
}
