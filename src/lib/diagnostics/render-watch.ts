/**
 * 렌더 폭주 감지. useEffect ↔ setState 루프처럼 오류 없이 화면만 멈추는 문제를
 * `[render-storm] <컴포넌트> N renders / 1s` 로 콘솔에 드러낸다.
 *
 * 무거운 페이지 컴포넌트 최상단에서 `useRenderWatch('InvoiceWorkPage')` 한 줄만 넣는다.
 */
import { useRef } from 'react'
import { isDiagnosticsEnabled } from './debug-flags'

/**
 * 임계값 근거: 송장작업 페이지 첫 진입은 쿼리 15개가 각각 렌더를 일으키고
 * StrictMode 가 두 배로 세어 1초에 25회 안팎이다. 진짜 effect 루프는 1초에 수백 회다.
 */
export const RENDER_STORM_WINDOW_MS = 1_000
export const RENDER_STORM_WARN_COUNT = 40
export const RENDER_STORM_ERROR_COUNT = 150

export type RenderStormLevel = 'ok' | 'warn' | 'error'

type RenderWindow = {
  startedAt: number
  count: number
  reportedLevel: RenderStormLevel
}

export function classifyRenderStorm(count: number): RenderStormLevel {
  if (count >= RENDER_STORM_ERROR_COUNT) return 'error'
  if (count >= RENDER_STORM_WARN_COUNT) return 'warn'
  return 'ok'
}

/**
 * 순수 판정 함수. 같은 1초 창 안에서 경고 단계가 올라갈 때만 true 를 준다.
 * 훅 밖(verify 스크립트)에서도 검증할 수 있게 상태를 인자로 받는다.
 */
export function stepRenderWindow(
  window: RenderWindow | null,
  now: number,
): { window: RenderWindow; report: RenderStormLevel | null } {
  if (!window || now - window.startedAt >= RENDER_STORM_WINDOW_MS) {
    return {
      window: { startedAt: now, count: 1, reportedLevel: 'ok' },
      report: null,
    }
  }
  const count = window.count + 1
  const level = classifyRenderStorm(count)
  const escalate =
    (level === 'warn' && window.reportedLevel === 'ok') ||
    (level === 'error' && window.reportedLevel !== 'error')
  return {
    window: {
      startedAt: window.startedAt,
      count,
      reportedLevel: escalate ? level : window.reportedLevel,
    },
    report: escalate ? level : null,
  }
}

export function useRenderWatch(name: string) {
  const windowRef = useRef<RenderWindow | null>(null)
  if (!isDiagnosticsEnabled()) return
  const next = stepRenderWindow(windowRef.current, performance.now())
  windowRef.current = next.window
  if (next.report === 'warn') {
    console.warn(
      `[render-storm] ${name} ${next.window.count} renders / 1s`,
      { path: `${location.pathname}${location.search}` },
    )
  } else if (next.report === 'error') {
    console.error(
      `[render-storm] ${name} ${next.window.count} renders / 1s — effect·setState 루프를 확인하세요`,
      { path: `${location.pathname}${location.search}` },
    )
  }
}
