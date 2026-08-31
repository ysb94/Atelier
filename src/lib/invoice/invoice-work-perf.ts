/**
 * 송장작업 저장·변환 경로를 개발 모드에서만 분리 계측한다.
 * 콘솔 필터: `[invoice-work]`
 */

const ENABLED = import.meta.env.DEV

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
  if (!ENABLED) return
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
  if (!ENABLED) return
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
  if (!ENABLED) return fn()
  const start = nowMs()
  const result = fn()
  const elapsed = Math.round(nowMs() - start)
  if (job) {
    console.debug(`[invoice-work] ${name} ${elapsed}ms`, { jobId: job.id })
  } else {
    console.debug(`[invoice-work] ${name} ${elapsed}ms`)
  }
  return result
}

export async function timeInvoiceWorkAsync<T>(
  name: string,
  fn: () => Promise<T>,
  job?: InvoiceWorkJob | null,
): Promise<T> {
  if (!ENABLED) return fn()
  const start = nowMs()
  try {
    return await fn()
  } finally {
    const elapsed = Math.round(nowMs() - start)
    if (job) {
      console.debug(`[invoice-work] ${name} ${elapsed}ms`, { jobId: job.id })
    } else {
      console.debug(`[invoice-work] ${name} ${elapsed}ms`)
    }
  }
}
