import { Link } from 'react-router-dom'
import { ArrowUpRight, CalendarDays, ClipboardList, Network, Users } from 'lucide-react'
import { primaryWorkOwner } from '@/components/layout/company-nav'
import { canManagePersonnel, isCompanyManager, isCompanyReviewer, OPERATIONS_SUPPORT_DEPARTMENT } from '@/lib/company/capabilities'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAuth } from '@/lib/supabase/auth'
import { HomeCalendar } from './HomeCalendar'
import { useMyClockIn } from './use-my-clock-in'
import './company-home.css'

export function CompanyHomePage() {
  useRenderWatch('CompanyHomePage')
  const { profile } = useAuth()
  const workHref = `/work-requests/${primaryWorkOwner(profile ?? {})}`
  const reviewer = isCompanyReviewer(profile)
  const operations = profile?.departmentName === OPERATIONS_SUPPORT_DEPARTMENT
  const personnel = canManagePersonnel(profile)
  const manager = isCompanyManager(profile)
  const roleLabel = reviewer ? '회사 현황' : operations ? '운영지원 업무' : manager ? '우리 팀 업무' : '나의 업무'
  const roleDescription = reviewer ? '회사 일정과 제작 중인 화면을 둘러보세요.' : operations ? '근태와 승인자 설정을 한곳에서 확인하세요.' : manager ? '팀 요청을 확인하고 담당자를 배정하세요.' : '요청한 업무와 나에게 배정된 일을 확인하세요.'
  const roleHref = reviewer ? '/org-chart' : operations ? '/operations-support' : workHref
  const clock = useMyClockIn()

  return <div className="company-home">
    <header className="home-heading">
      <div><p className="home-eyebrow">E&J · MY WORKSPACE</p><h1>{profile?.displayName || '직원'}님, 안녕하세요. <span className="home-welcome">반갑습니다.</span></h1><p className="home-subtitle">오늘의 일정을 살펴보고, 필요한 업무를 이어가세요.</p><p className="home-profile-line">{profile?.departmentName || '소속 미지정'} · {profile?.position || '직책 미지정'}</p></div>
      <section className="home-attendance-summary" aria-label="내 근태 현황">
        <div className="home-section-heading"><h2>내 근태 현황</h2><Link to="/settings/profile" className="home-text-link">내 기록 보기<ArrowUpRight size={12} /></Link></div>
        <dl><div><dt>이번 달 지각</dt><dd>— <span>회</span></dd></div><div><dt>남은 연차</dt><dd>— <span>일</span></dd></div><div><dt>이번 달 야근</dt><dd>— <span>시간</span></dd></div></dl>
        <p>실제 근태·연차 기록 연결 예정</p>
      </section>
    </header>
    <HomeCalendar clockIns={clock.byDate} needsClockIn={clock.needsClockIn} clocking={clock.saving} clockError={clock.error} onClockIn={() => { void clock.clockIn().catch(() => { /* 실패 로그는 clockInToday에 있고, 버튼 아래에 이유를 보여 준다. */ }) }} sidebar={<>
      <section className="home-side-card home-role-card"><div className="home-section-heading"><h2>{roleLabel}</h2><ClipboardList size={16} /></div><p>{roleDescription}</p><Link to={roleHref} className="home-action-link">{reviewer ? '조직 현황 보기' : operations ? '운영지원 열기' : manager ? '팀 업무판 열기' : '내 업무 열기'}<ArrowUpRight size={15} /></Link></section>
      <section className="home-side-card"><div className="home-section-heading"><h2>오늘의 근무</h2></div><div className="home-attendance"><span>출근 <b className={clock.todayClock ? 'is-recorded' : ''}>{clock.todayClock || '—'}</b></span><span>퇴근 <b>—</b></span></div>{!clock.todayClock && <p className="home-clock-hint">출근 전입니다. 캘린더 가운데 출근하기를 누르면 지금 시각이 기록됩니다.</p>}<Link to="/settings/profile" className="home-text-link">휴가·야근 신청과 내 기록 보기 <ArrowUpRight size={12} /></Link></section>
      <nav className="home-shortcuts" aria-label="홈 업무 바로가기"><Link to="/work"><ClipboardList size={16} />업무 허브<ArrowUpRight size={13} /></Link><Link to="/meetings"><CalendarDays size={16} />회의<ArrowUpRight size={13} /></Link><Link to="/org-chart"><Network size={16} />조직도<ArrowUpRight size={13} /></Link>{personnel && <Link to="/members"><Users size={16} />멤버·권한<ArrowUpRight size={13} /></Link>}</nav>
    </>} />
  </div>
}
