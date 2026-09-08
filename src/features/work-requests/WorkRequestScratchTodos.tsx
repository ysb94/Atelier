import { useEffect, useState, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { formatSlashDate, formatTime } from './work-request-schedule'

type ScratchTodo = {
  id: string
  text: string
  done: boolean
  createdAt: string
}

function createdAtFromId(id: string): string | undefined {
  const stamp = /^todo-([a-z0-9]+)-/i.exec(id)?.[1]
  if (!stamp) return undefined
  const ms = Number.parseInt(stamp, 36)
  if (!Number.isFinite(ms) || ms < 1e12 || ms > Date.now() + 60_000) {
    return undefined
  }
  return new Date(ms).toISOString()
}

function formatCreatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  return sameDay ? formatTime(value) : `${formatSlashDate(value)} ${formatTime(value)}`
}

function storageKey(owner: string, profileId?: string | null) {
  return `atelier:work-scratch-todos:${owner}:${profileId || 'local'}`
}

function loadTodos(key: string): ScratchTodo[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ScratchTodo[]
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (
        !item ||
        typeof item.id !== 'string' ||
        typeof item.text !== 'string' ||
        typeof item.done !== 'boolean'
      ) {
        return []
      }
      const createdAt =
        typeof item.createdAt === 'string' && item.createdAt
          ? item.createdAt
          : createdAtFromId(item.id) ?? ''
      return [{ id: item.id, text: item.text, done: item.done, createdAt }]
    })
  } catch {
    return []
  }
}

function saveTodos(key: string, items: ScratchTodo[]) {
  try {
    localStorage.setItem(key, JSON.stringify(items))
  } catch {
    // ignore
  }
}

export function WorkRequestScratchTodos({
  owner,
  profileId,
}: {
  owner: string
  profileId?: string | null
}) {
  const key = storageKey(owner, profileId)
  const [items, setItems] = useState<ScratchTodo[]>(() => loadTodos(key))
  const [draft, setDraft] = useState('')

  useEffect(() => {
    setItems(loadTodos(key))
    setDraft('')
  }, [key])

  useEffect(() => {
    saveTodos(key, items)
  }, [items, key])

  function addTodo() {
    const text = draft.trim()
    if (!text) return
    setItems((current) => [
      ...current,
      {
        id: `todo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        text,
        done: false,
        createdAt: new Date().toISOString(),
      },
    ])
    setDraft('')
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    addTodo()
  }

  const openCount = items.filter((item) => !item.done).length

  return (
    <aside className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">간단 할 일</h3>
        <span className="text-[11px] text-muted-foreground">
          {openCount > 0 ? `${openCount}건` : '없음'}
        </span>
      </div>
      <p className="mb-3 text-[11px] leading-4 text-muted-foreground">
        요청으로 올리지 않고 바로 처리할 일을 적어둡니다.
      </p>
      <form className="mb-2 flex gap-1.5" onSubmit={handleSubmit}>
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="예: 샘플 사진 확인"
          className="h-8 px-2 text-sm"
        />
        <Button
          type="submit"
          size="icon"
          variant="outline"
          className="size-8 shrink-0"
          aria-label="할 일 추가"
          disabled={!draft.trim()}
        >
          <Plus className="size-3.5" />
        </Button>
      </form>
      {items.length === 0 ? (
        <p className="px-0.5 py-3 text-xs text-muted-foreground">
          한 줄만 적으면 됩니다.
        </p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-1.5 rounded-md px-1 py-1 hover:bg-muted/50"
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 size-3.5 shrink-0 accent-current"
                  checked={item.done}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((row) =>
                        row.id === item.id
                          ? { ...row, done: event.target.checked }
                          : row,
                      ),
                    )
                  }
                />
                <span
                  className={cn(
                    'min-w-0 flex-1 text-sm leading-5',
                    item.done && 'text-muted-foreground line-through',
                  )}
                >
                  {item.text}
                </span>
                {item.createdAt ? (
                  <time
                    dateTime={item.createdAt}
                    className="mt-0.5 shrink-0 text-[10px] tabular-nums text-muted-foreground"
                  >
                    {formatCreatedAt(item.createdAt)}
                  </time>
                ) : null}
              </label>
              <button
                type="button"
                aria-label={`${item.text} 삭제`}
                className="mt-0.5 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() =>
                  setItems((current) =>
                    current.filter((row) => row.id !== item.id),
                  )
                }
              >
                <Trash2 className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
