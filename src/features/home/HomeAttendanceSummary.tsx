import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight } from 'lucide-react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { attendanceMonthDates, koreaDateKey } from '@/features/settings/my-attendance'
import { type PersonalRequest } from '@/features/settings/personal-requests'
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

  return <section className="home-attendance-summary" aria-label="내 근태 현황">
    <div className="home-section-heading"><h2>내 근태 현황</h2><Link to="/settings/profile" className="home-text-link">내 기록 보기<ArrowUpRight size={12} /></Link></div>
    <dl>
      <div><dt>이번 달 지각</dt><dd>{clock.exempt ? '제외' : lateLoading ? '…' : basis.isError ? '조회 실패' : summary.late == null ? '기준 미설정' : amount(summary.late, '회')}</dd></div>
      <div><dt>남은 연차</dt><dd>{leaveLoading ? '…' : basis.isError ? '조회 실패' : basisRow?.remainingAnnualLeave == null ? '미등록' : amount(basisRow.remainingAnnualLeave, '일')}</dd></div>
      <div><dt>이번 달 야근</dt><dd>{overtimeLoading ? '…' : leaves.isError ? '조회 실패' : amount(summary.overtime, '시간')}</dd></div>
    </dl>
    <p>월별 출퇴근 기록은 My home에서 확인하세요.</p>
  </section>
}
