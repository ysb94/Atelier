/**
 * TanStack Query 재조회 폭주 감지.
 * 같은 queryKey 가 짧은 시간에 반복 fetch 되면 `[query-storm]` 으로 알린다.
 * (예: 매 렌더마다 새 배열로 만든 queryKey, invalidate 루프)
 */
import type { QueryClient } from '@tanstack/react-query'
import { isDiagnosticsEnabled } from './debug-flags'
import { safeInteractionContext as diagnosticContext } from './perf-watch'

export const QUERY_STORM_WINDOW_MS = 10_000
export const QUERY_STORM_WARN_COUNT = 6
export const QUERY_SLOW_WARN_MS = 3_000

type FetchWindow = { startedAt: number; count: number; reported: boolean }
type PendingFetch = { startedAt: number; timer: ReturnType<typeof setTimeout> }

/** 검색어·직원 UUID·요청 본문은 진단 로그에 복사하지 않는다. */
export function diagnosticQueryName(queryKey: readonly unknown[]): string {
  const name = queryKey[0]
  return typeof name === 'string'
    && /^[a-z][a-z0-9_-]{0,79}$/i.test(name)
    && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)
    ? name
    : 'query'
}

const installed = new WeakMap<QueryClient, () => void>()

export function stepFetchWindow(
  window: FetchWindow | undefined,
  now: number,
): { window: FetchWindow; report: boolean } {
  if (!window || now - window.startedAt >= QUERY_STORM_WINDOW_MS) {
    return { window: { startedAt: now, count: 1, reported: false }, report: false }
  }
  const count = window.count + 1
  const report = !window.reported && count >= QUERY_STORM_WARN_COUNT
  return {
    window: { startedAt: window.startedAt, count, reported: window.reported || report },
    report,
  }
}

export function installQueryWatch(queryClient: QueryClient) {
  const existing = installed.get(queryClient)
  if (existing) return existing
  if (!isDiagnosticsEnabled()) return () => {}
  const windows = new Map<string, FetchWindow>()
  const pending = new Map<string, PendingFetch>()
  const clearPending = (key: string) => {
    const current = pending.get(key)
    if (current) clearTimeout(current.timer)
    pending.delete(key)
    return current
  }
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    const key = event.query.queryHash
    if (event.type === 'removed') {
      clearPending(key)
      windows.delete(key)
      return
    }
    if (event.type !== 'updated') return
    const action = event.action
    const queryName = diagnosticQueryName(event.query.queryKey)
    if (action.type === 'fetch' || action.type === 'continue') {
      clearPending(key)
      if (event.query.state.fetchStatus === 'fetching') {
        const startedAt = performance.now()
        const timer = setTimeout(() => {
          if (!isDiagnosticsEnabled() || event.query.state.fetchStatus !== 'fetching') return
          console.warn('[perf] pending-query 응답 대기 중', {
            queryName,
            elapsedMs: Math.round(performance.now() - startedAt),
            ...diagnosticContext(),
          })
        }, QUERY_SLOW_WARN_MS)
        pending.set(key, { startedAt, timer })
      }
      // 오프라인 해제는 재요청 폭주로 집계하지 않는다.
      if (action.type === 'continue') return
      const next = stepFetchWindow(windows.get(key), performance.now())
      windows.set(key, next.window)
      if (next.report) {
        console.warn(
          `[query-storm] ${next.window.count}회 / 10s 같은 쿼리를 다시 불러옵니다`,
          { queryName, ...diagnosticContext() },
        )
      }
      return
    }
    // setQueryData는 진행 중 요청을 끝내지 않는다. 취소·pause는 경고 없이 정리한다.
    if (event.query.state.fetchStatus !== 'fetching') {
      const current = clearPending(key)
      if (!current || !isDiagnosticsEnabled()) return
      const elapsed = performance.now() - current.startedAt
      if (action.type === 'error') {
        const code = (action.error as { code?: unknown } | null)?.code
        console.error('[query-storm] fetch 실패', {
          queryName,
          elapsedMs: Math.round(elapsed),
          errorCode: typeof code === 'string' && /^[A-Z0-9_]{1,20}$/.test(code) ? code : null,
          ...diagnosticContext(),
        })
      } else if (action.type === 'success' && elapsed >= QUERY_SLOW_WARN_MS) {
        console.warn(`[perf] slow-query ${Math.round(elapsed)}ms`, {
          queryName,
          ...diagnosticContext(),
        })
      }
    }
  })
  const cleanup = () => {
    unsubscribe()
    for (const key of pending.keys()) clearPending(key)
    windows.clear()
    installed.delete(queryClient)
  }
  installed.set(queryClient, cleanup)
  return cleanup
}
