export type ScheduleTodo = { id: string; date: string; title: string; done: boolean }

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function parseScheduleTodos(value: unknown): ScheduleTodo[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const items: ScheduleTodo[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    const date = typeof row.date === 'string' ? row.date : ''
    const title = typeof row.title === 'string' ? row.title.trim() : ''
    if (!id || seen.has(id) || !DATE.test(date) || !title) continue
    seen.add(id)
    items.push({ id, date, title: title.slice(0, 160), done: row.done === true })
  }
  return items
}

export function scheduleTodoKey(userId: string) {
  return `atelier:my-schedule-todos:${userId}`
}

export function readScheduleTodos(userId: string): ScheduleTodo[] {
  try {
    const raw = localStorage.getItem(scheduleTodoKey(userId))
    return raw ? parseScheduleTodos(JSON.parse(raw)) : []
  } catch (error) {
    console.warn('[my-attendance] 개인 Todo 읽기 실패', error)
    return []
  }
}

export function writeScheduleTodos(userId: string, items: ScheduleTodo[]) {
  try {
    localStorage.setItem(scheduleTodoKey(userId), JSON.stringify(items))
  } catch (error) {
    console.warn('[my-attendance] 개인 Todo 저장 실패', error)
  }
}
