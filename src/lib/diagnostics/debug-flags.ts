/**
 * 콘솔 진단 스위치.
 *
 * - 개발 모드(`import.meta.env.DEV`)에서는 항상 켠다.
 * - 배포 사이트에서는 브라우저 콘솔에서 `atelierDebug.on()` 을 한 번 실행하면
 *   `localStorage['atelier:debug'] = '1'` 이 저장돼 새로고침 뒤에도 유지된다.
 *   끄려면 `atelierDebug.off()`.
 *
 * 모든 진단 로그는 `[perf]`, `[render-storm]`, `[query-storm]`, `[app-error]`,
 * `[invoice-work]` 접두어를 쓴다. 콘솔 필터에 접두어를 넣으면 해당 항목만 본다.
 */

const STORAGE_KEY = 'atelier:debug'

function readStorageFlag(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

let cached: boolean | null = null

export function isDiagnosticsEnabled(): boolean {
  if (cached === null) {
    cached = import.meta.env.DEV || readStorageFlag()
  }
  return cached
}

export function setDiagnosticsEnabled(enabled: boolean) {
  try {
    if (enabled) globalThis.localStorage?.setItem(STORAGE_KEY, '1')
    else globalThis.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    // 저장소를 못 써도 현재 세션에는 반영한다.
  }
  cached = import.meta.env.DEV || enabled
}

declare global {
  interface Window {
    atelierDebug?: {
      on: () => void
      off: () => void
      enabled: () => boolean
    }
  }
}

/** 콘솔에서 `atelierDebug.on()`으로 배포 사이트 진단을 켤 수 있게 한다. */
export function exposeDiagnosticsSwitch() {
  if (typeof window === 'undefined') return
  window.atelierDebug = {
    on: () => {
      setDiagnosticsEnabled(true)
      console.info(
        '[perf] 진단 로그를 켰습니다. 새로고침 뒤에도 유지됩니다. 끄려면 atelierDebug.off()',
      )
    },
    off: () => {
      setDiagnosticsEnabled(false)
      console.info('[perf] 진단 로그를 꺼뜨렸습니다.')
    },
    enabled: () => isDiagnosticsEnabled(),
  }
}
