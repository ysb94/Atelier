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

const CHAT_LIST_TIME_ZONE = 'Asia/Seoul'

function seoulDateKey(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CHAT_LIST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms))
}

function seoulClock(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHAT_LIST_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms))
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00'
  const hour24 = Number.isFinite(hour) ? hour % 24 : 0
  const period = hour24 < 12 ? '오전' : '오후'
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return `${period} ${String(hour12).padStart(2, '0')}:${minute}`
}

export function chatDateKey(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  return seoulDateKey(then)
}

/** 말풍선 옆 시각. 한국 시간, 오전/오후. */
export function formatChatClock(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  return seoulClock(then)
}

/** 대화 날짜 구분. 예: 2026-09-30 (수). */
export function formatChatDateLabel(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const weekday = new Intl.DateTimeFormat('ko-KR', {
    timeZone: CHAT_LIST_TIME_ZONE,
    weekday: 'short',
  })
    .format(new Date(then))
    .replace('요일', '')
  return `${seoulDateKey(then)} (${weekday})`
}

/** 채팅 목록 시간. 오늘은 오전/오후, 어제, 그 이전은 한국 날짜. */
export function formatChatListTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const thenKey = seoulDateKey(then)
  const todayKey = seoulDateKey(now)
  if (thenKey === todayKey) return seoulClock(then)
  const yesterdayKey = seoulDateKey(now - 24 * 60 * 60 * 1000)
  if (thenKey === yesterdayKey) return '어제'
  return thenKey
}

/** 이름 옆에 직책을 붙여 선임·후임이 보이게 한다. 직책이 없으면 이름만 쓴다. */
export function formatChatPerson(
  name: string | null | undefined,
  position: string | null | undefined,
): string {
  const label = name?.trim() || '이름 없음'
  const role = position?.trim()
  return role ? `${label} ${role}` : label
}

/** 10 이상은 9+ 로 줄인다. 0이면 배지를 숨긴다. */
export function inboxBadgeLabel(count: number): string | null {
  if (count <= 0) return null
  if (count > 9) return '9+'
  return String(count)
}
