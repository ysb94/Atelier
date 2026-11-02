import { ATTENDANCE_GRACE_MINUTES } from '../operations-support/attendance-start-settings'
import { isWorkday } from '../operations-support/monthly-attendance'

function clockSeconds(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 3600 + minute * 60
}

export const LATE_ATTACHMENT_LIMIT = 5
export const LATE_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024
const BLOCKED_ATTACHMENT = /\.(exe|dll|bat|cmd|ps1|msi|com|scr|vbs|js|jar|sh)$/i

/** 올릴 수 없는 파일이면 안내 문구를 반환한다. */
export function lateAttachmentError(name: string, size: number) {
  const trimmed = name.trim()
  if (trimmed.length < 1 || trimmed.length > 200 || size < 1 || size > LATE_ATTACHMENT_MAX_BYTES || BLOCKED_ATTACHMENT.test(trimmed)) {
    return '20MB 이하의 실행 파일이 아닌 서류만 올려 주세요.'
  }
  return ''
}

/** 기준 시각과 실제 출근의 차이. 허용 시간 안이면 0이다. */
export function lateMinutes(start: string, actual: string, grace = ATTENDANCE_GRACE_MINUTES) {
  const baseline = clockSeconds(start)
  const clock = clockSeconds(actual.slice(0, 5))
  if (baseline == null || clock == null || clock <= baseline + grace * 60) return 0
  return Math.floor((clock - baseline) / 60)
}

export type LateTotal = { count: number; minutes: number }

/** 올해 1월 1일부터 기준일까지, 근무일의 지각 횟수와 지각 분 합계. */
export function cumulativeLateTotal(clocks: readonly { date: string; clockIn: string }[], startFor: (date: string) => string, through: string): LateTotal {
  const from = `${through.slice(0, 4)}-01-01`
  const seen = new Set<string>()
  let count = 0
  let minutes = 0
  for (const clock of clocks) {
    if (clock.date < from || clock.date > through || seen.has(clock.date) || !isWorkday(clock.date, {})) continue
    seen.add(clock.date)
    const late = lateMinutes(startFor(clock.date), clock.clockIn)
    if (late <= 0) continue
    count += 1
    minutes += late
  }
  return { count, minutes }
}

export function cumulativeLateText(total: LateTotal) {
  const hours = Math.floor(total.minutes / 60)
  const rest = total.minutes % 60
  const duration = [hours ? `${hours}시간` : '', rest || !hours ? `${rest}분` : ''].filter(Boolean).join(' ')
  return `${total.count}회 (${duration})`
}

/** 확인란에 남길 이름과 한국 날짜. */
export function lateConfirmStamp(name: string, at: string | null) {
  if (!name) return ''
  if (!at) return name
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(at))
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  return `${name} ${value('year')}.${Number(value('month'))}.${Number(value('day'))}`
}
