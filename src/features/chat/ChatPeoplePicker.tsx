import { formatChatPerson } from '@/lib/inbox/format'
import type { ChatDirectoryPerson } from '@/lib/inbox/types'
import { cn } from '@/lib/utils'

export function ChatPeoplePicker({
  people,
  selectedIds,
  onToggle,
}: {
  people: readonly ChatDirectoryPerson[]
  selectedIds: ReadonlySet<string>
  onToggle: (profileId: string) => void
}) {
  if (people.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
        선택할 동료가 없습니다.
      </p>
    )
  }

  return (
    <ul>
      {people.map((person) => {
        const selected = selectedIds.has(person.profileId)
        return (
          <li key={person.profileId}>
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => onToggle(person.profileId)}
              className={cn(
                'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted',
                selected && 'bg-muted',
              )}
            >
              <span
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded border border-border text-[10px]',
                  selected && 'border-primary bg-primary text-primary-foreground',
                )}
                aria-hidden
              >
                {selected ? '✓' : ''}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {formatChatPerson(person.displayName, person.position)}
                </span>
                {person.departmentName ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {person.departmentName}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
