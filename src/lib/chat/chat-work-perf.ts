/**
 * 채팅 파일 변환·올리기 소요 시간.
 * 개발 모드에서는 항상, 배포에서는 콘솔 `atelierDebug.on()` 뒤에 켜진다.
 * 콘솔 필터: `[chat-work]`
 */
import { isDiagnosticsEnabled } from '@/lib/diagnostics/debug-flags'

const SLOW_INFO_MS = 200
const SLOW_WARN_MS = 1_000

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function logTimed(name: string, elapsed: number) {
  const level =
    elapsed >= SLOW_WARN_MS ? 'warn' : elapsed >= SLOW_INFO_MS ? 'info' : 'debug'
  console[level](`[chat-work] ${name} ${elapsed}ms`)
}

export async function timeChatWork<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isDiagnosticsEnabled()) return fn()
  const start = nowMs()
  try {
    return await fn()
  } finally {
    logTimed(name, Math.round(nowMs() - start))
  }
}
