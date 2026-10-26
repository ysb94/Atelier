import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { useMyClockIn } from './use-my-clock-in'
import './company-home.css'

export function HomeAttendanceSummary() {
  const clock = useMyClockIn()
  return <section className="home-attendance-summary" aria-label="내 근태 현황">
    <div className="home-section-heading"><h2>내 근태 현황</h2><Link to="/settings/profile" className="home-text-link">내 기록 보기<ArrowUpRight size={12} /></Link></div>
    <dl><div><dt>이번 달 지각</dt><dd>{clock.exempt ? '제외' : <>— <span>회</span></>}</dd></div><div><dt>남은 연차</dt><dd>— <span>일</span></dd></div><div><dt>이번 달 야근</dt><dd>— <span>시간</span></dd></div></dl>
    <p>월별 출퇴근 기록은 My home에서 확인하세요.</p>
  </section>
}
