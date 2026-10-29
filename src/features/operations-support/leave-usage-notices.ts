import type { InboxNotification } from '@/lib/inbox/types'
import { LEAVE_NOTICE_LABELS, type LeaveNoticeEmployee, type BaseLeaveNoticePhase, type LeaveUsageNotice } from '@/lib/supabase/leave-usage-notices'

export function leaveNoticeItems(records: readonly LeaveUsageNotice[]): InboxNotification[] {
  return records.map(row => ({ id: row.id, kind: 'leave_usage_notice', title: `${row.title} · ${LEAVE_NOTICE_LABELS[row.phase]}`, body: `${row.recipient_name}님 · ${row.reason ? `${row.reason} · ` : ''}${row.phase === 'registered' ? `부여 ${row.granted_days}일` : `신청 가능 ${row.remaining_days}일`} · ${row.expires_on}까지`, href: '/settings/profile?part=my-attendance', createdAt: row.issued_at, readAt: row.read_at }))
}
export function leaveNoticeTime(value: string | null) {
  return value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)) : '—'
}
export function leaveNoticeDates(reset: string) {
  const expiry = new Date(`${reset}T00:00:00Z`); expiry.setUTCDate(expiry.getUTCDate() - 1)
  function monthOffset(months: number) {
    const shifted = new Date(expiry); const day = shifted.getUTCDate()
    shifted.setUTCDate(1); shifted.setUTCMonth(shifted.getUTCMonth() - months)
    const last = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate()
    shifted.setUTCDate(Math.min(day, last)); return shifted.toISOString().slice(0, 10)
  }
  const fortnight = new Date(expiry); fortnight.setUTCDate(fortnight.getUTCDate() - 14)
  return { expiresOn: expiry.toISOString().slice(0, 10), threeMonths: monthOffset(3), oneMonth: monthOffset(1), twoWeeks: fortnight.toISOString().slice(0, 10) }
}
export function leaveNoticeSetupReason(employee: LeaveNoticeEmployee) {
  if (employee.resigned_on) return '퇴사일 등록 — 발송 제외'
  if (!employee.hire_date) return '입사일 미등록'
  if (!employee.reset_date) return '입사 전 — 발송 제외'
  if (employee.remaining_days === null) return '잔여 연차 미등록'
  if (employee.remaining_days <= 0) return '잔여 연차 없음'
  if (!employee.balance_current) return '사용연도 잔여 확인 필요'
  return null
}
export function leaveNoticeReceipt(row: LeaveUsageNotice) {
  return [`연차 사용 안내 기록`, `문서 ID: ${row.id}`, `수신자: ${row.recipient_name} (${row.employee_id})`, ...(row.grant_id ? [`사유: ${row.reason}`, `부여 일수: ${row.granted_days}일`, `발송 당시 사용 예약: ${row.reserved_days}일`] : [`입사일: ${row.hire_date}`]), `사용기한: ${row.expires_on}`, `안내 단계: ${LEAVE_NOTICE_LABELS[row.phase]}`, `안내 예정일: ${row.scheduled_on}`, `발송 당시 신청 가능: ${row.remaining_days}일`, `발송: ${leaveNoticeTime(row.issued_at)}`, `알림 읽음: ${leaveNoticeTime(row.read_at)}`, `안내문 열람: ${leaveNoticeTime(row.viewed_at)}`, `본인 확인: ${leaveNoticeTime(row.confirmed_at)}`, `시간 기준: 한국 시간 · 서버 기록`, '', '발송 원문', row.body, '', '일반 사용 안내 및 확인 기록입니다. 법정 사용촉진 절차나 수당 포기 동의의 완료를 뜻하지 않습니다.'].join('\n')
}
export function downloadLeaveNoticeReceipt(row: LeaveUsageNotice) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', leaveNoticeReceipt(row)], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `연차안내_${row.recipient_name}_${row.expires_on}_${row.phase}.txt`; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export type NoticePhaseDates = Record<BaseLeaveNoticePhase, string>
