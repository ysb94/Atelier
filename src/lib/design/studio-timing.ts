/** Visible at Chrome's default log level even when a calculation throws. */
export function timeStudioWork<T>(name: string, work: () => T): T {
  const started = performance.now()
  try { return work() }
  finally {
    const elapsedMs = Math.round(performance.now() - started)
    if (elapsedMs >= 200) {
      const context = { name, elapsedMs, path: typeof location === 'undefined' ? 'test' : location.pathname, lastInput: '이미지 생성' }
      if (elapsedMs >= 1000) console.warn('[styled-image] 느린 계산', context)
      else console.info('[styled-image] 계산 완료', context)
    }
  }
}
