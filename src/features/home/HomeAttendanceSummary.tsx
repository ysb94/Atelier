import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { attendanceMonthDates, koreaDateKey } from '@/features/settings/my-attendance'
import { type PersonalRequest } from '@/features/settings/personal-requests'
import { listMyExtraLeave } from '@/lib/supabase/employee-extra-leave'
import { listLeaveRequests } from '@/lib/supabase/leave-requests'
import { getMyAttendanceBasis } from '@/lib/supabase/my-attendance-basis'
import { useAuth } from '@/lib/supabase/auth'
import { emptyList } from '@/lib/utils'
import { approvedOvertimeHours, countMyLateDays } from './my-attendance-summary'
import { useMyClockIn } from './use-my-clock-in'
import './company-home.css'

function amount(value: number, unit: string) {
  const shown = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(value)
  return <>{shown} <span>{unit}</span></>
}

function remainingLeaveAmount(base: number | null | undefined, additional: number | null | undefined, total: number | null) {
  if (total == null) return '미등록'
  if (additional == null || additional <= 0 || base == null) return amount(total, '일')
  const format = (value: number) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(value)
  return <>{format(base)} <span>+</span> {format(additional)} <span>일</span></>
}

function extraLeaveLabel(days: number, expires: string, note: string) {
  const shown = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(days)
  return `+${shown}일 (${expires.slice(2).replaceAll('-', '.')}까지) [${note}]`
}

function AdditionalLeaveHistory({ userId, children }: { userId: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const history = useQuery({
    queryKey: ['my-extra-leave', userId],
    queryFn: listMyExtraLeave,
    enabled: open,
  })
  useEffect(() => {
    if (open) dialog.current?.showModal()
  }, [open])
  useEffect(() => {
    if (history.error) console.warn('[home-attendance] 추가 연차 이력 조회 실패', history.error)
  }, [history.error])
  return <>
    <button type="button" className="home-leave-split" aria-haspopup="dialog" aria-expanded={open} aria-label="추가 연차 이력 보기" onClick={() => setOpen(true)}>
      {children}
    </button>
    {open ? <dialog ref={dialog} className="home-extra-leave-dialog" aria-label="추가 연차 이력" onClose={() => setOpen(false)} onCancel={() => setOpen(false)}>
      <h3>추가 이력</h3>
      {history.isPending ? <p>불러오는 중…</p> : history.isError ? <p role="alert">추가 연차 이력을 불러오지 못했습니다.</p> : history.data.length === 0 ? <p>추가 이력이 없습니다.</p> : (
        <ul>
          {history.data.map(entry => <li key={entry.id}>{extraLeaveLabel(entry.days, entry.expires, entry.note)}</li>)}
        </ul>
      )}
      <button type="button" onClick={() => dialog.current?.close()}>닫기</button>
    </dialog> : null}
  </>
}

export function HomeAttendanceSummary() {
  const clock = useMyClockIn()
  const { profile, session } = useAuth()
  const userId = session?.user.id ?? ''
  const active = useWorkspaceTabActivity()
  const allowed = profile?.status === 'active' && Boolean(userId)
  const today = koreaDateKey()
  const month = today.slice(0, 7)
  const dates = useMemo(() => attendanceMonthDates(month), [month])
  const basis = useQuery({
    queryKey: ['my-attendance-basis', userId, month],
    queryFn: () => getMyAttendanceBasis(userId, month),
    enabled: allowed && active,
    refetchInterval: allowed && active ? 30_000 : false,
  })
  const leaves = useQuery({
    queryKey: ['home-my-leave', userId, dates[0], dates[dates.length - 1]],
    queryFn: () => listLeaveRequests(userId, false, { from: dates[0], to: dates[dates.length - 1] }),
    enabled: allowed && active,
  })
  useEffect(() => {
    if (leaves.error) console.warn('[home-attendance] 이번 달 신청 조회 실패', leaves.error)
  }, [leaves.error])
  const requests = leaves.data ?? emptyList<PersonalRequest>()
  const basisRow = basis.data
  const summary = useMemo(() => ({
    late: basisRow ? countMyLateDays(clock.rows.filter(row => row.date.startsWith(month)), basisRow.start, basisRow.grace, today) : null,
    overtime: approvedOvertimeHours(requests, month),
  }), [basisRow, clock.rows, month, today, requests])
  const lateLoading = !clock.exempt && (clock.loading || (allowed && basis.isPending))
  const leaveLoading = allowed && basis.isPending
  const overtimeLoading = allowed && leaves.isPending

  return <details className="home-attendance-summary">
    <summary><h2>내 근태 현황</h2></summary>
    <dl>
      <div><dt>이번 달 지각</dt><dd>{clock.exempt ? '제외' : lateLoading ? '…' : basis.isError ? '조회 실패' : summary.late == null ? '기준 미설정' : amount(summary.late, '회')}</dd></div>
      <div><dt>남은 연차</dt><dd className={basisRow?.additionalAnnualLeave != null && basisRow.additionalAnnualLeave > 0 ? 'is-split' : undefined}>{leaveLoading ? '…' : basis.isError ? '조회 실패' : basisRow?.additionalAnnualLeave != null && basisRow.additionalAnnualLeave > 0 && basisRow.baseAnnualLeave != null ? <AdditionalLeaveHistory userId={userId}>{remainingLeaveAmount(basisRow.baseAnnualLeave, basisRow.additionalAnnualLeave, basisRow.remainingAnnualLeave)}</AdditionalLeaveHistory> : remainingLeaveAmount(basisRow?.baseAnnualLeave, basisRow?.additionalAnnualLeave, basisRow?.remainingAnnualLeave ?? null)}</dd></div>
      <div><dt>이번 달 야근</dt><dd>{overtimeLoading ? '…' : leaves.isError ? '조회 실패' : amount(summary.overtime, '시간')}</dd></div>
    </dl>
    <p>월별 출퇴근 기록은 My home에서 확인하세요.</p>
  </details>
}
