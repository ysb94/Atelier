import type { LogisticsLeaveKind, LogisticsRecord } from '@/lib/supabase/logistics-operations'

export const LOGISTICS_LEAVE_LABELS: Record<LogisticsLeaveKind, string> = { annual: '연차', half: '반차', quarter: '반반차', official: '공가', other: '기타 휴가' }
export function logisticsLocalTime(value: string | null) {
  if (!value) return ''
  const stamp = new Date(value).getTime()
  return Number.isNaN(stamp) ? '' : new Date(stamp + 9 * 3600_000).toISOString().slice(0, 16)
}
export function logisticsInstant(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const stamp = new Date(`${value}:00+09:00`)
  return Number.isNaN(stamp.getTime()) || logisticsLocalTime(stamp.toISOString()) !== value ? null : stamp.toISOString()
}
export function logisticsWorkMinutes(record: Pick<LogisticsRecord, 'started_at' | 'ended_at' | 'break_minutes'>) {
  if (!record.started_at || !record.ended_at) return 0
  return Math.max(0, Math.round((new Date(record.ended_at).getTime() - new Date(record.started_at).getTime()) / 60_000) - record.break_minutes)
}
export function logisticsDuration(minutes: number) { return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분` }
