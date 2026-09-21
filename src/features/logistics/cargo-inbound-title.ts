import { formatNumber } from '@/lib/utils'

const WEEKDAY_KO = ['월', '화', '수', '목', '금'] as const

/** 선적일 2026-09-01, 83박스 → "260901 선적 83박스 건" */
export function formatCargoInboundTitle(shippedAt: string, boxCount: number) {
  const compact = shippedAt.replaceAll('-', '')
  const stamp = /^\d{8}$/.test(compact) ? compact.slice(2) : '미정'
  return `${stamp} 선적 ${formatNumber(boxCount)}박스 건`
}

export function formatInboundBoxJob(boxCount: number) {
  return `입고 확정 ${formatNumber(boxCount)}박스 건`
}

export function toLocalDateKey(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 이번 주 월~금. 일요일은 직전 월요일부터 센다. */
export function thisWeekWorkdays(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekday = start.getDay()
  start.setDate(start.getDate() + (weekday === 0 ? -6 : 1 - weekday))
  const todayKey = toLocalDateKey(now)
  return WEEKDAY_KO.map((label, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    const key = toLocalDateKey(date)
    return { key, weekday: label, day: date.getDate(), isToday: key === todayKey }
  })
}
