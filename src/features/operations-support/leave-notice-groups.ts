import { LEAVE_NOTICE_PHASES, type LeaveNoticeEmployee, type LeaveNoticeManagement, type LeaveNoticePhase, type LeaveNoticeSource, type LeaveUsageNotice } from '@/lib/supabase/leave-usage-notices'
import { leaveNoticeDates, leaveNoticeSetupReason } from './leave-usage-notices'

export const LEAVE_SOURCE_LABELS: Record<LeaveNoticeSource, string> = { base: '기본 연차', extra: '추가 연차', birthday: '생일 반차' }
export type LeaveNoticeGroupItem = { id: string; source: LeaveNoticeSource; reason: string; remaining: number | null; reserved: number | null; expires: string | null; blocked: string | null; phases: { phase: LeaveNoticePhase; date: string; included: boolean }[]; notices: LeaveUsageNotice[] }
export function employeeLeaveNoticeItems(employee: LeaveNoticeEmployee, data: LeaveNoticeManagement): LeaveNoticeGroupItem[] {
  const dates = employee.reset_date ? leaveNoticeDates(employee.reset_date) : null
  const base: LeaveNoticeGroupItem = { id: `base:${employee.id}`, source: 'base', reason: '입사일 기준', remaining: employee.remaining_days, reserved: null,
    expires: dates?.expiresOn ?? null, blocked: leaveNoticeSetupReason(employee),
    phases: dates ? LEAVE_NOTICE_PHASES.map(phase => ({ phase, date: dates[phase], included: false })) : [],
    notices: data.notices.filter(n => n.employee_id === employee.id && !n.grant_id && n.expires_on === dates?.expiresOn),
  }
  const extras = (data.extraGrants ?? []).filter(g => g.employee_id === employee.id).map(g => {
    const after = new Date(`${g.expires_on}T00:00:00Z`); after.setUTCDate(after.getUTCDate() + 1)
    const schedule = leaveNoticeDates(after.toISOString().slice(0, 10))
    const week = new Date(`${g.expires_on}T00:00:00Z`); week.setUTCDate(week.getUTCDate() - 7)
    const records = data.notices.filter(n => n.grant_id === g.id && n.grant_version === g.version && !n.invalidated_at)
    const registration = records.find(n => n.phase === 'registered')
    const issued = registration ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date(registration.issued_at)) : ''
    const cutoff = [g.created_on, g.updated_on, g.starts_on, issued].sort().at(-1)!
    const phases: LeaveNoticeGroupItem['phases'] = [{ phase: 'registered', date: issued || g.created_on, included: false },
      ...(g.notice_source === 'birthday' ? [{ phase: 'oneWeek' as const, date: week.toISOString().slice(0, 10), included: week.toISOString().slice(0, 10) <= cutoff }]
        : LEAVE_NOTICE_PHASES.map(phase => ({ phase, date: schedule[phase], included: schedule[phase] <= cutoff }))),
    ]
    return { id: g.id, source: g.notice_source, reason: g.reason, remaining: g.deleted_at || g.expires_on < data.today || g.starts_on > data.today ? 0 : Number(g.available), reserved: Number(g.reserved), expires: g.expires_on,
      blocked: g.deleted_at ? '부여 취소' : employee.resigned_on ? '퇴사일 등록' : g.expires_on < data.today ? '기한 만료' : Number(g.available) <= 0 ? '모두 사용·예약됨' : null,
      phases, notices: records,
    }
  })
  return [base, ...extras]
}
export function itemPendingNotices(item: LeaveNoticeGroupItem) {
  return item.notices.filter(n => !n.confirmed_at && !n.invalidated_at && (!item.blocked || (n.phase === 'registered' && item.blocked === '모두 사용·예약됨')))
}
