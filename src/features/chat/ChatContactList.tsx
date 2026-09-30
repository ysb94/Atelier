import { useMemo, useState } from 'react'
import type { ChatDirectoryPerson } from '@/lib/inbox/types'
import { emptyList } from '@/lib/utils'
import { ChatPersonAvatar } from './ChatAvatar'
import { useChatDirectory } from './use-chat'

function errorText(error: unknown) {
  return error instanceof Error ? error.message : '채팅방을 열지 못했습니다.'
}

export function ChatContactList({
  query,
  onOpen,
}: {
  query: string
  onOpen: (person: ChatDirectoryPerson) => Promise<void>
}) {
  const directory = useChatDirectory(true)
  const people = directory.data ?? emptyList<ChatDirectoryPerson>()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return people
    return people.filter((person) =>
      [person.displayName, person.departmentName, person.position]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(needle)),
    )
  }, [people, query])

  async function choose(person: ChatDirectoryPerson) {
    if (pendingId) return
    setError(null)
    setPendingId(person.profileId)
    try {
      await onOpen(person)
    } catch (caught) {
      console.warn('[chat] 연락처에서 대화 열기 실패', {
        profileId: person.profileId,
        message: caught instanceof Error ? caught.message : String(caught),
      })
      setError(errorText(caught))
    } finally {
      setPendingId(null)
    }
  }

  if (directory.isLoading) {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
        동료 명단을 불러오는 중입니다.
      </p>
    )
  }

  if (directory.error) {
    return (
      <p className="px-4 py-6 text-center text-sm text-danger">
        {errorText(directory.error)}
      </p>
    )
  }

  return (
    <>
      {error ? (
        <p className="px-3 pt-2 text-xs text-danger">{error}</p>
      ) : null}
      {people.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          등록된 동료가 없습니다.
        </p>
      ) : filtered.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          검색 결과가 없습니다.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {filtered.map((person) => {
            const pending = pendingId === person.profileId
            return (
              <li key={person.profileId}>
                <button
                  type="button"
                  disabled={pendingId !== null}
                  aria-busy={pending}
                  onClick={() => void choose(person)}
                  className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted disabled:opacity-60"
                >
                  <ChatPersonAvatar
                    profileId={person.profileId}
                    name={person.displayName}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      <span className="font-semibold">{person.displayName}</span>
                      {person.position ? (
                        <span className="ml-1 font-normal text-muted-foreground">
                          {person.position}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {pending
                        ? '대화를 여는 중입니다.'
                        : person.departmentName || '부서 없음'}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
