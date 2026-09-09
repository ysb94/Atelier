/**
 * 브라우저 전역 성능 감시. 렉이 걸리면 콘솔에 "어디서" 막혔는지 남긴다.
 *
 * 1. `longtask` PerformanceObserver: 메인 스레드가 한 번에 오래 점유되면 `[perf] long-task`.
 * 2. rAF 프레임 간격 감시: 프레임이 끊기면 `[perf] frame-stall` + 마지막 사용자 입력 대상.
 * 3. window `error` / `unhandledrejection`: `[app-error]`.
 *
 * 마지막 입력 대상을 함께 찍으므로 "무엇을 누른 뒤 멈췄는지"를 바로 볼 수 있다.
 */
import { isDiagnosticsEnabled } from './debug-flags'

export const PERF_LONG_TASK_WARN_MS = 120
export const PERF_FRAME_STALL_WARN_MS = 400
export const PERF_FRAME_STALL_ERROR_MS = 2_000

let installed = false

type LastInteraction = {
  at: number
  kind: string
  target: string
}

let lastInteraction: LastInteraction | null = null

/** 요소를 짧게 설명한다. 개인정보가 들어갈 수 있는 input 값은 넣지 않는다. */
export function describeEventTarget(target: EventTarget | null): string {
  if (!(target instanceof Element)) return 'window'
  const element =
    target.closest('button, a, [role="button"], input, select, textarea, [data-testid]') ??
    target
  const tag = element.tagName.toLowerCase()
  const label =
    element.getAttribute('aria-label') ??
    element.getAttribute('data-testid') ??
    (element instanceof HTMLInputElement
      ? element.getAttribute('placeholder') ?? element.type
      : element.textContent?.trim().slice(0, 40))
  return label ? `${tag}:${label}` : tag
}

function rememberInteraction(event: Event) {
  lastInteraction = {
    at: performance.now(),
    kind: event.type,
    target: describeEventTarget(event.target),
  }
}

function interactionContext() {
  return {
    path: `${location.pathname}${location.search}`,
    lastInput: lastInteraction
      ? `${lastInteraction.kind} ${lastInteraction.target} (${Math.round(
          performance.now() - lastInteraction.at,
        )}ms 전)`
      : null,
  }
}

export function classifyFrameStall(gapMs: number): 'ok' | 'warn' | 'error' {
  if (gapMs >= PERF_FRAME_STALL_ERROR_MS) return 'error'
  if (gapMs >= PERF_FRAME_STALL_WARN_MS) return 'warn'
  return 'ok'
}

function watchLongTasks() {
  if (typeof PerformanceObserver === 'undefined') return
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < PERF_LONG_TASK_WARN_MS) continue
        console.warn(
          `[perf] long-task ${Math.round(entry.duration)}ms`,
          interactionContext(),
        )
      }
    })
    observer.observe({ type: 'longtask', buffered: true })
  } catch {
    // longtask 미지원 브라우저는 프레임 감시만 쓴다.
  }
}

function watchFrameStalls() {
  let last = performance.now()
  const tick = () => {
    const now = performance.now()
    const gap = now - last
    last = now
    const level = classifyFrameStall(gap)
    if (level === 'error') {
      console.error(
        `[perf] frame-stall ${Math.round(gap)}ms 메인 스레드가 멈췄습니다`,
        interactionContext(),
      )
    } else if (level === 'warn' && document.visibilityState === 'visible') {
      console.warn(`[perf] frame-stall ${Math.round(gap)}ms`, interactionContext())
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  document.addEventListener('visibilitychange', () => {
    // 탭이 숨겨진 동안의 간격은 렉이 아니다.
    last = performance.now()
  })
}

function watchErrors() {
  window.addEventListener('error', (event) => {
    console.error('[app-error] uncaught', {
      message: event.message,
      source: `${event.filename}:${event.lineno}:${event.colno}`,
      ...interactionContext(),
    })
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    console.error('[app-error] unhandled-rejection', {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      ...interactionContext(),
    })
  })
}

/**
 * 앱 시작 시 한 번 호출한다. 진단이 꺼져 있으면 아무것도 등록하지 않는다.
 */
export function installPerfWatch() {
  if (installed) return
  if (typeof window === 'undefined') return
  if (!isDiagnosticsEnabled()) return
  installed = true
  for (const type of ['pointerdown', 'keydown', 'submit', 'change'] as const) {
    window.addEventListener(type, rememberInteraction, { capture: true, passive: true })
  }
  watchLongTasks()
  watchFrameStalls()
  watchErrors()
  console.info(
    '[perf] 진단 감시 시작. 필터: [perf] [render-storm] [query-storm] [app-error] [invoice-work]',
  )
}
