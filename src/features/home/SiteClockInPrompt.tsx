import { useEffect, useState } from 'react'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAuth } from '@/lib/supabase/auth'
import { readImpersonationState } from '@/lib/supabase/impersonation'
import { clockInHiddenForOperator, developerCanSkipClockIn } from './clock-in-prompt'
import { useMyClockIn } from './use-my-clock-in'
import './company-home.css'

const SKIP_KEY = 'atelier:clock-in-developer-skip'

function readSkipTarget() {
  try {
    return sessionStorage.getItem(SKIP_KEY)
  } catch {
    return null // 저장소를 열 수 없으면 이번 화면에서만 건너뛴다.
  }
}

function writeSkipTarget(targetId: string) {
  try {
    sessionStorage.setItem(SKIP_KEY, targetId)
  } catch {
    // 저장에 실패해도 버튼 클릭으로 이번 화면은 넘어간다.
  }
}

export function SiteClockInPrompt() {
  useRenderWatch('SiteClockInPrompt')
  const { session } = useAuth()
  const clock = useMyClockIn()
  const stored = readImpersonationState()
  const developerSkip = developerCanSkipClockIn(session?.user.id, stored)
  const [skippedTarget, setSkippedTarget] = useState<string | null>(readSkipTarget)
  const hidden = clockInHiddenForOperator(session?.user.id, stored)
  const skipped = developerSkip && stored?.targetId === skippedTarget
  if (!clock.needsClockIn || hidden || skipped) return null
  return <HomeClockInButton
    busy={clock.saving}
    error={clock.error}
    onClockIn={() => { void clock.clockIn().catch(() => { /* 실패 로그는 clockInToday에 있고, 버튼 아래에 이유를 보여 준다. */ }) }}
    onSkip={developerSkip && stored ? () => { writeSkipTarget(stored.targetId); setSkippedTarget(stored.targetId) } : undefined}
  />
}

function HomeClockInButton({ busy, error, onClockIn, onSkip }: { busy: boolean; error: string; onClockIn: () => void; onSkip?: () => void }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const time = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
  return <div className="home-clock-in-overlay" role="dialog" aria-label="출근하기">
    <div className="home-clock-in-stack">
      <button type="button" className="home-clock-in" disabled={busy} onClick={onClockIn}>
        <small>지금 시각</small>
        <strong>{time}</strong>
        <span>{busy ? '기록 중…' : '출근하기'}</span>
      </button>
      {onSkip && <button type="button" className="home-clock-in-skip" onClick={onSkip}>개발자입니다</button>}
    </div>
    {error && <p role="alert">{error}</p>}
  </div>
}
