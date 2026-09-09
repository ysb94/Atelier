/**
 * 송장작업 저장·변환 경로를 계측한다.
 * 개발 모드에서는 항상, 배포에서는 콘솔 `atelierDebug.on()` 뒤에 켜진다.
 * 콘솔 필터: `[invoice-work]`
 *
 * 로그 레벨: 기본은 debug(Verbose)이고, SLOW_INFO_MS 이상이면 info,
 * SLOW_WARN_MS 이상이면 warn 으로 올려 기본 콘솔 필터에서도 보이게 한다.
 */
import { isDiagnosticsEnabled } from '@/lib/diagnostics/debug-flags'

export const INVOICE_WORK_SLOW_INFO_MS = 200
export const INVOICE_WORK_SLOW_WARN_MS = 1_000

function enabled() {
  return isDiagnosticsEnabled()
}

export function invoiceWorkLogLevel(
  elapsedMs: number,
): 'debug' | 'info' | 'warn' {
  if (elapsedMs >= INVOICE_WORK_SLOW_WARN_MS) return 'warn'
  if (elapsedMs >= INVOICE_WORK_SLOW_INFO_MS) return 'info'
  return 'debug'
}

function logTimed(
  name: string,
  elapsed: number,
  extra?: Record<string, unknown>,
) {
  const level = invoiceWorkLogLevel(elapsed)
  const message = `[invoice-work] ${name} ${elapsed}ms`
  if (extra) console[level](message, extra)
  else console[level](message)
}

export type InvoiceWorkStage =
  | 'parse'
  | 'criteria'
  | 'gift'
  | 'instruction'
  | 'product'
  | 'item'
  | 'list'
  | 'output'
  | 'product-ai'
  | 'item-ai'
  | 'worker-clone'
  | 'worker-compute'
  | 'tab-commit'
  | 'ai-review-render'
  | 'total'

export type InvoiceWorkJob = {
  id: string
  startedAt: number
  marks: Partial<Record<InvoiceWorkStage, number>>
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function nextJobId() {
  return `job-${Math.round(nowMs()).toString(36)}-${Math.floor(
    Math.random() * 1e6,
  ).toString(36)}`
}

export function logInvoiceWork(
  name: string,
  extra?: Record<string, unknown>,
) {
  if (!enabled()) return
  if (extra) console.debug(`[invoice-work] ${name}`, extra)
  else console.debug(`[invoice-work] ${name}`)
}

export function createInvoiceWorkJob(id = nextJobId()): InvoiceWorkJob {
  const job: InvoiceWorkJob = {
    id,
    startedAt: nowMs(),
    marks: {},
  }
  logInvoiceWork('job-start', { jobId: job.id })
  return job
}

export function markInvoiceWorkStage(
  job: InvoiceWorkJob | null | undefined,
  stage: InvoiceWorkStage,
  extra?: Record<string, unknown>,
) {
  if (!job) return
  job.marks[stage] = nowMs()
  if (!enabled()) return
  console.debug(
    `[invoice-work] ${stage} ${Math.round(nowMs() - job.startedAt)}ms`,
    { jobId: job.id, ...extra },
  )
}

export function finishInvoiceWorkJob(
  job: InvoiceWorkJob | null | undefined,
  extra?: Record<string, unknown>,
) {
  if (!job) return
  markInvoiceWorkStage(job, 'total', extra)
}

export function timeInvoiceWork<T>(
  name: string,
  fn: () => T,
  job?: InvoiceWorkJob | null,
): T {
  if (!enabled()) return fn()
  const start = nowMs()
  const result = fn()
  const elapsed = Math.round(nowMs() - start)
  logTimed(name, elapsed, job ? { jobId: job.id } : undefined)
  return result
}

export async function timeInvoiceWorkAsync<T>(
  name: string,
  fn: () => Promise<T>,
  job?: InvoiceWorkJob | null,
): Promise<T> {
  if (!enabled()) return fn()
  const start = nowMs()
  try {
    return await fn()
  } finally {
    const elapsed = Math.round(nowMs() - start)
    logTimed(name, elapsed, job ? { jobId: job.id } : undefined)
  }
}
