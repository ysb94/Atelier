import type { InboxNotification } from '@/lib/inbox/types'

export const LEAVE_SAMPLE_DEVELOPER = 'd0000000-0000-4000-8000-000000000001'
export const LEAVE_SAMPLE_PHASES = ['threeMonths', 'oneMonth', 'twoWeeks'] as const
export type LeaveSamplePhase = typeof LEAVE_SAMPLE_PHASES[number]
export const LEAVE_SAMPLE_LABELS: Record<LeaveSamplePhase, string> = { threeMonths: '3개월 전', oneMonth: '1개월 전', twoWeeks: '2주 전' }
const PHASE_COPY: Record<LeaveSamplePhase, { title: string; introduction: string; request: string }> = {
  threeMonths: { title: '연차 사용 안내', introduction: '연차 사용기한이 3개월 남아 안내드립니다.', request: '업무 일정에 맞춰 사용기한 내 남은 연차를 사용해 주시기 바랍니다.' },
  oneMonth: { title: '연차 사용 재안내', introduction: '연차 사용기한이 1개월 남아 다시 안내드립니다.', request: '남은 연차와 사용기한을 다시 확인하시어 기한 내 사용을 부탁드립니다.' },
  twoWeeks: { title: '연차 사용기한 임박 안내', introduction: '연차 사용기한이 2주 앞으로 다가왔습니다.', request: '사용 가능한 기간이 얼마 남지 않았으니, 업무 일정을 확인하시어 남은 연차를 기한 내 사용해 주시기 바랍니다.' },
}
export const LEAVE_SAMPLE_HREF = '/operations-support?part=leave&leaveView=alarm'
export type LeaveAlarmSample = {
  id: string; phase: LeaveSamplePhase; recipientId: string; recipientName: string
  remaining: number; expiresOn: string; simulatedOn: string; issuedAt: string; body: string
  readAt: string | null; viewedAt: string | null; confirmedAt: string | null
  title?: string
}

function dayKey(date: Date) { return date.toISOString().slice(0, 10) }
export function sampleToday(now = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now) }
function moveMonths(day: string, amount: number) {
  const [y, m, d] = day.split('-').map(Number)
  const end = new Date(Date.UTC(y, m - 1 + amount + 1, 0)).getUTCDate()
  return dayKey(new Date(Date.UTC(y, m - 1 + amount, Math.min(d, end))))
}
function moveDays(day: string, amount: number) { const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return dayKey(date) }
export function createLeaveAlarmSamples(phases: readonly LeaveSamplePhase[], now = new Date()): LeaveAlarmSample[] {
  const expiresOn = moveMonths(sampleToday(now), 3)
  return phases.map(phase => {
    const simulatedOn = phase === 'threeMonths' ? moveMonths(expiresOn, -3) : phase === 'oneMonth' ? moveMonths(expiresOn, -1) : moveDays(expiresOn, -14)
    const copy = PHASE_COPY[phase]
    const expiryLabel = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'long' }).format(new Date(`${expiresOn}T00:00:00Z`))
    const body = `안녕하세요. E&J 운영지원팀입니다.\n\n개발자님, ${copy.introduction}\n\n남은 연차: 7일\n사용기한: ${expiryLabel}까지\n\n${copy.request}\n\n잔여 연차와 사용기한을 확인하신 후 아래 ‘확인하고 닫기’ 버튼을 눌러 주세요.\n문의사항이 있으시면 운영지원팀으로 연락해 주세요.\n\n감사합니다.\nE&J 운영지원팀`
    return { id: `leave-sample:${crypto.randomUUID()}`, phase, recipientId: LEAVE_SAMPLE_DEVELOPER, recipientName: '개발자', remaining: 7, expiresOn, simulatedOn, issuedAt: now.toISOString(), title: copy.title, body, readAt: null, viewedAt: null, confirmedAt: null }
  })
}
export function sampleNotifications(records: readonly LeaveAlarmSample[]): InboxNotification[] {
  return records.map(record => ({ id: record.id, kind: 'leave_alarm_sample', title: `${record.title ?? '연차 사용 안내'} · ${LEAVE_SAMPLE_LABELS[record.phase]}`, body: `개발자님, 남은 연차는 ${record.remaining}일입니다. ${record.expiresOn}까지 사용을 부탁드립니다.`, href: '/settings/profile?part=my-attendance', createdAt: record.issuedAt, readAt: record.readAt }))
}
export function sampleReceipt(record: LeaveAlarmSample) {
  return `[개발자 연차 알림 샘플 기록 — 법적 증빙 아님]\n문서 번호: ${record.id}\n수신자: ${record.recipientName} (${record.recipientId})\n실제 샘플 발송: ${record.issuedAt}\n알림 읽음: ${record.readAt ?? '미읽음'}\n안내문 열람: ${record.viewedAt ?? '미열람'}\n본인 확인: ${record.confirmedAt ?? '미확인'}\n\n발송 당시 안내문 원본\n${record.body}\n\n이 브라우저에서 검수한 샘플 기록입니다. 운영 서버의 발송·수신 증명 또는 법정 사용촉진 완료 기록이 아닙니다.`
}
export function sampleTimestamp(value: string | null) {
  return value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)) : '—'
}
export function downloadSampleReceipt(record: LeaveAlarmSample) {
  const url = URL.createObjectURL(new Blob([sampleReceipt(record)], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = `연차알림_샘플기록_${record.phase}_${record.id.slice(-8)}.txt`; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
