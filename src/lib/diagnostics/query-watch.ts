/**
 * TanStack Query 재조회 폭주 감지.
 * 같은 queryKey 가 짧은 시간에 반복 fetch 되면 `[query-storm]` 으로 알린다.
 * (예: 매 렌더마다 새 배열로 만든 queryKey, invalidate 루프)
 */
import type { QueryClient } from '@tanstack/react-query'
import { isDiagnosticsEnabled } from './debug-flags'

export const QUERY_STORM_WINDOW_MS = 10_000
export const QUERY_STORM_WARN_COUNT = 6
export const QUERY_SLOW_WARN_MS = 3_000

type FetchWindow = { startedAt: number; count: number; reported: boolean }

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
  if (!isDiagnosticsEnabled()) return
  const windows = new Map<string, FetchWindow>()
  const fetchStartedAt = new Map<string, number>()
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated') return
    const action = event.action
    const key = event.query.queryHash
    if (action.type === 'fetch') {
      fetchStartedAt.set(key, performance.now())
      const next = stepFetchWindow(windows.get(key), performance.now())
      windows.set(key, next.window)
      if (next.report) {
        console.warn(
          `[query-storm] ${next.window.count}회 / 10s 같은 쿼리를 다시 불러옵니다`,
          { queryKey: event.query.queryKey },
        )
      }
      return
    }
    if (action.type === 'success' || action.type === 'error') {
      const started = fetchStartedAt.get(key)
      fetchStartedAt.delete(key)
      if (started == null) return
      const elapsed = performance.now() - started
      if (action.type === 'error') {
        console.error('[query-storm] fetch 실패', {
          queryKey: event.query.queryKey,
          elapsedMs: Math.round(elapsed),
          error:
            action.error instanceof Error ? action.error.message : action.error,
        })
      } else if (elapsed >= QUERY_SLOW_WARN_MS) {
        console.warn(`[perf] slow-query ${Math.round(elapsed)}ms`, {
          queryKey: event.query.queryKey,
        })
      }
    }
  })
}
