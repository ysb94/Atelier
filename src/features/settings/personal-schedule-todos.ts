export type ScheduleTodo = { id: string; date: string; title: string; done: boolean; start?: string; end?: string; important?: boolean }
export type ScheduleTodoForm = { id?: string; date: string; title: string; start: string; end: string; important: boolean; done: boolean }

const DATE = /^\d{4}-\d{2}-\d{2}$/
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/
export function scheduleTodoError(row: Pick<ScheduleTodoForm, 'date'|'title'|'start'|'end'|'important'>) {
  if (!DATE.test(row.date) || !Number.isFinite(Date.parse(`${row.date}T00:00:00Z`)) || new Date(`${row.date}T00:00:00Z`).toISOString().slice(0,10) !== row.date) return '날짜를 확인해 주세요.'
  if (!row.title.trim()) return '할 일을 입력해 주세요.'
  if (row.title.trim().length > 160) return '할 일은 160자 이하로 입력해 주세요.'
  if (row.important && (!row.start || !row.end)) return '중요 작업은 회의와 비교할 시작·종료 시각을 지정해 주세요.'
  if ((row.start || row.end) && (!CLOCK.test(row.start) || !CLOCK.test(row.end) || row.end <= row.start)) return '같은 날의 종료 시각을 시작 시각보다 늦게 지정해 주세요.'
  return ''
}
export const scheduleTodoTime = (row: ScheduleTodo) => row.start && row.end ? `${row.start}–${row.end}` : '시간 미지정'

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
    const start = typeof row.start === 'string' ? row.start : '', end = typeof row.end === 'string' ? row.end : ''
    const timed = CLOCK.test(start) && CLOCK.test(end) && end > start
    items.push({ id, date, title: title.slice(0, 160), done: row.done === true, ...(timed ? { start, end, ...(row.important === true ? { important: true } : {}) } : {}) })
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
