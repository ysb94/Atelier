import { useMemo, useState, type ReactNode } from 'react'
import {
  AtSign,
  Check,
  CircleAlert,
  ScanBarcode,
  Truck,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatInboxTime } from '@/lib/inbox/format'
import type { InboxNotification, InboxNotificationKind } from '@/lib/inbox/types'
import { cn } from '@/lib/utils'

const KIND_ICON: Record<
  InboxNotificationKind,
  { icon: typeof ScanBarcode; label: string }
> = {
  barcode_request: { icon: ScanBarcode, label: '발급 요청' },
  barcode_issued: { icon: Check, label: '발급 완료' },
  barcode_pending: { icon: CircleAlert, label: '미지정' },
  outbound_changed: { icon: Truck, label: '출고 변경' },
  mention: { icon: AtSign, label: '언급' },
}

export function NotificationPanel({
  items,
  titleId,
  onMarkAllRead,
  onOpen,
  onClose,
}: {
  items: readonly InboxNotification[]
  titleId: string
  onMarkAllRead: () => void
  onOpen: (item: InboxNotification) => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const unreadCount = useMemo(
    () => items.filter((item) => !item.readAt).length,
    [items],
  )
  const visible = useMemo(
    () => (filter === 'unread' ? items.filter((item) => !item.readAt) : items),
    [filter, items],
  )

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <h2 id={titleId} className="text-sm font-medium">
          알림
        </h2>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={unreadCount === 0}
            onClick={onMarkAllRead}
          >
            모두 읽음
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="알림 닫기"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </header>

      <div className="flex shrink-0 gap-1 border-b border-border px-3 py-2">
        <FilterButton
          selected={filter === 'all'}
          onClick={() => setFilter('all')}
        >
          전체
        </FilterButton>
        <FilterButton
          selected={filter === 'unread'}
          onClick={() => setFilter('unread')}
        >
          {`안 읽음${unreadCount > 0 ? ` ${unreadCount}` : ''}`}
        </FilterButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {filter === 'unread' ? '안 읽은 알림이 없습니다.' : '알림이 없습니다.'}
          </p>
        ) : (
          <ul>
            {visible.map((item) => {
              const meta = KIND_ICON[item.kind]
              const Icon = meta.icon
              const unread = !item.readAt
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(item)}
                    className={cn(
                      'flex w-full gap-3 px-3 py-3 text-left transition-colors hover:bg-muted',
                      unread && 'bg-primary/5',
                    )}
                  >
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Icon className="size-4" aria-label={meta.label} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          {item.title}
                        </span>
                        {unread ? (
                          <span
                            className="mt-1.5 size-2 shrink-0 rounded-full bg-danger"
                            aria-label="안 읽음"
                          />
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                        {item.body}
                      </span>
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        {formatInboxTime(item.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

function FilterButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
        selected
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
