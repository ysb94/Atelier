import { isDiagnosticsEnabled } from '@/lib/diagnostics/debug-flags'
import { interactionContext } from '@/lib/diagnostics/perf-watch'

export function barcodeHistoryLogLevel(elapsedMs: number): 'debug' | 'info' | 'warn' {
  return elapsedMs >= 1_000 ? 'warn' : elapsedMs >= 200 ? 'info' : 'debug'
}

function context() {
  return typeof location === 'undefined'
    ? { path: null, lastInput: null }
    : interactionContext()
}

function report(name: string, startedAt: number, extra?: Record<string, unknown>) {
  if (!isDiagnosticsEnabled()) return
  const elapsedMs = Math.round(performance.now() - startedAt)
  const level = barcodeHistoryLogLevel(elapsedMs)
  console[level](`[barcode-history] ${name} ${elapsedMs}ms`, { ...context(), ...extra })
}

export function timeBarcodeHistory<T>(name: string, fn: () => T): T {
  const startedAt = performance.now()
  try {
    return fn()
  } finally {
    report(name, startedAt)
  }
}

export async function timeBarcodeHistoryAsync<T>(
  name: string,
  fn: () => Promise<T>,
  extra?: Record<string, unknown>,
): Promise<T> {
  const startedAt = performance.now()
  try {
    return await fn()
  } catch (error) {
    console.warn(`[barcode-history] ${name} 실패`, { ...context(), ...extra, error })
    throw error
  } finally {
    report(name, startedAt, extra)
  }
}
