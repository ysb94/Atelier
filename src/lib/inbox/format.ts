export function formatInboxTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const diff = Math.max(0, now - then)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '방금'
  if (diff < hour) return `${Math.floor(diff / minute)}분 전`
  if (diff < day) return `${Math.floor(diff / hour)}시간 전`
  if (diff < 7 * day) return `${Math.floor(diff / day)}일 전`
  const date = new Date(then)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

/** 10 이상은 9+ 로 줄인다. 0이면 배지를 숨긴다. */
export function inboxBadgeLabel(count: number): string | null {
  if (count <= 0) return null
  if (count > 9) return '9+'
  return String(count)
}
