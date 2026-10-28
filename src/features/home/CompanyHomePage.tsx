import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, CalendarDays, ClipboardList, Network, Users } from 'lucide-react'
import { primaryWorkOwner } from '@/components/layout/company-nav'
import { canManagePersonnel, isCompanyManager, isCompanyReviewer, canAccessOperationsSupport } from '@/lib/company/capabilities'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAuth } from '@/lib/supabase/auth'
import { HomeAttendanceSummary } from './HomeAttendanceSummary'
import { HomeCalendar } from './HomeCalendar'
import { useMyClockIn } from './use-my-clock-in'
import { Button } from '@/components/ui/button'
import './company-home.css'

export function CompanyHomePage() {
  useRenderWatch('CompanyHomePage')
  const { profile } = useAuth()
  const workHref = `/work-requests/${primaryWorkOwner(profile ?? {})}`
  const reviewer = isCompanyReviewer(profile)
  const operations = canAccessOperationsSupport(profile) && !isCompanyReviewer(profile)
  const personnel = canManagePersonnel(profile)
  const manager = isCompanyManager(profile)
  const roleLabel = reviewer ? '회사 현황' : operations ? '운영지원 업무' : manager ? '우리 팀 업무' : '나의 업무'
  const roleDescription = reviewer ? '회사 일정과 제작 중인 화면을 둘러보세요.' : operations ? '근태와 승인자 설정을 한곳에서 확인하세요.' : manager ? '팀 요청을 확인하고 담당자를 배정하세요.' : '요청한 업무와 나에게 배정된 일을 확인하세요.'
  const roleHref = reviewer ? '/org-chart' : operations ? '/operations-support' : workHref
  const clock = useMyClockIn()
  const [clockOutOpen, setClockOutOpen] = useState(false)

  return <div className="company-home">
    <header className="home-heading">
      <div><p className="home-eyebrow">E&J · MY WORKSPACE</p><h1>{profile?.displayName || '직원'}님, 안녕하세요. <span className="home-welcome">반갑습니다.</span></h1><p className="home-subtitle">오늘의 일정을 살펴보고, 필요한 업무를 이어가세요.</p><p className="home-profile-line">{profile?.departmentName || '소속 미지정'} · {profile?.position || '직책 미지정'}</p></div>
      <HomeAttendanceSummary />
    </header>
    <HomeCalendar clockIns={clock.byDate} sidebar={<>
      <section className="home-side-card home-role-card"><div className="home-section-heading"><h2>{roleLabel}</h2><ClipboardList size={16} /></div><p>{roleDescription}</p><Link to={roleHref} className="home-action-link">{reviewer ? '조직 현황 보기' : operations ? '운영지원 열기' : manager ? '팀 업무판 열기' : '내 업무 열기'}<ArrowUpRight size={15} /></Link></section>
      <section className="home-side-card"><div className="home-section-heading"><h2>오늘의 근무</h2></div><div className="home-attendance"><span>출근 <b className={clock.todayClock ? 'is-recorded' : ''}>{clock.todayClock || '—'}</b></span><span>퇴근 <b className={clock.todayClockOut ? 'is-recorded' : ''}>{clock.todayClockOut || '—'}</b></span></div>{clock.exempt ? <p className="home-clock-hint">출퇴근 제외자로 지정되어 지각·결근 관리에 포함되지 않습니다.</p> : !clock.todayClock && <p className="home-clock-hint">출근 전입니다. 화면의 출근하기를 누르면 지금 시각이 기록됩니다.</p>}{clock.needsClockOut && <Button className="my-3 w-full" variant="outline" disabled={clock.saving} onClick={() => setClockOutOpen(true)}>{clock.saving ? '저장 중…' : '퇴근하기'}</Button>}{clock.todayClockOut && !clock.exempt && <Button className="my-3 w-full" variant="outline" disabled={clock.saving} onClick={() => { void clock.undoClockOut().catch(error => console.warn('[attendance-clock] 홈 퇴근 취소 실패', error)) }}>{clock.saving ? '저장 중…' : '퇴근 무르기'}</Button>}{clock.todayClock && clock.error && <p role="alert" className="text-sm text-danger">{clock.error}</p>}<Link to="/settings/profile" className="home-text-link">휴가·야근 신청과 내 기록 보기 <ArrowUpRight size={12} /></Link></section>
      <nav className="home-shortcuts" aria-label="홈 업무 바로가기"><Link to="/settings/profile?part=work"><ClipboardList size={16} />내 업무<ArrowUpRight size={13} /></Link><Link to="/settings/profile?part=meetings"><CalendarDays size={16} />회의<ArrowUpRight size={13} /></Link><Link to="/org-chart"><Network size={16} />조직도<ArrowUpRight size={13} /></Link>{personnel && <Link to="/members"><Users size={16} />멤버·권한<ArrowUpRight size={13} /></Link>}</nav>
    </>} />
    <ClockOutDialog open={clockOutOpen} saving={clock.saving} error={clock.error} onCancel={() => setClockOutOpen(false)} onConfirm={() => { void clock.clockOut().then(() => setClockOutOpen(false)).catch(error => console.warn('[attendance-clock] 홈 퇴근 버튼 저장 실패', error)) }} />
  </div>
}

function ClockOutDialog({ open, saving, error, onCancel, onConfirm }: { open: boolean, saving: boolean, error: string, onCancel: () => void, onConfirm: () => void }) {
  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])
  if (!open) return null
  return <div className="home-clock-out-dialog" role="presentation"><button type="button" className="home-clock-out-backdrop" aria-label="닫기" onClick={onCancel} /><section className="home-clock-out-panel" role="dialog" aria-modal="true" aria-labelledby="home-clock-out-title"><h2 id="home-clock-out-title">퇴근하기</h2><p>퇴근 시각을 기록할까요?</p>{error && <p role="alert">{error}</p>}<div className="home-clock-out-actions"><Button type="button" variant="outline" onClick={onCancel}>취소</Button><Button type="button" disabled={saving} onClick={onConfirm}>{saving ? '저장 중…' : '퇴근 기록'}</Button></div></section></div>
}
