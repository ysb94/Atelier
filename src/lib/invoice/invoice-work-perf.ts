/**
 * 송장작업 저장·변환 경로를 개발 모드에서만 분리 계측한다.
 * 콘솔 필터: `[invoice-work]`
 */

const ENABLED = import.meta.env.DEV

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function logInvoiceWork(
  name: string,
  extra?: Record<string, unknown>,
) {
  if (!ENABLED) return
  if (extra) console.debug(`[invoice-work] ${name}`, extra)
  else console.debug(`[invoice-work] ${name}`)
}

export function timeInvoiceWork<T>(name: string, fn: () => T): T {
  if (!ENABLED) return fn()
  const start = nowMs()
  const result = fn()
  console.debug(`[invoice-work] ${name} ${Math.round(nowMs() - start)}ms`)
  return result
}

export async function timeInvoiceWorkAsync<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!ENABLED) return fn()
  const start = nowMs()
  try {
    return await fn()
  } finally {
    console.debug(`[invoice-work] ${name} ${Math.round(nowMs() - start)}ms`)
  }
}
