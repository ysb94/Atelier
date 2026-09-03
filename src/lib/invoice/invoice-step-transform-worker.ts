import { INVOICE_COMPUTE_WORKER_MIN_ROWS } from '@/lib/invoice/invoice-work-thresholds'
import {
  runInvoiceItemNameStep,
  runInvoiceProductNameStep,
  type InvoiceItemNameStepInput,
  type InvoiceProductNameStepInput,
  type InvoiceProductNameStepResult,
} from '@/lib/invoice/invoice-step-transform'
import type { InvoiceItemNameTransformation } from '@/lib/invoice/item-name-transform'
import {
  logInvoiceWork,
  markInvoiceWorkStage,
} from '@/lib/invoice/invoice-work-perf'
import type {
  InvoiceStepTransformWorkerRequest,
  InvoiceStepTransformWorkerResponse,
} from '@/lib/invoice/invoice-step-transform.worker'

const COMPUTE_TIMEOUT_MS = 120_000

let nextRequestId = 1
let sharedWorker: Worker | null = null
const pendingById = new Map<
  number,
  {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    startedAt: number
    timer: number
  }
>()

export type CancellableCompute<T> = Promise<T> & { cancel: () => void }

function resolved<T>(value: T): CancellableCompute<T> {
  const promise = Promise.resolve(value) as CancellableCompute<T>
  promise.cancel = () => {}
  return promise
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function rejectPending(id: number, error: Error) {
  const pending = pendingById.get(id)
  if (!pending) return
  pendingById.delete(id)
  window.clearTimeout(pending.timer)
  pending.reject(error)
}

function disposeWorker() {
  if (!sharedWorker) return
  sharedWorker.terminate()
  sharedWorker = null
  for (const [id, pending] of pendingById) {
    pendingById.delete(id)
    window.clearTimeout(pending.timer)
    pending.reject(new Error('변환 계산이 취소되었습니다.'))
  }
}

function getSharedWorker() {
  if (sharedWorker) return sharedWorker
  const worker = new Worker(
    new URL('./invoice-step-transform.worker.ts', import.meta.url),
    { type: 'module' },
  )
  worker.onmessage = (
    event: MessageEvent<InvoiceStepTransformWorkerResponse>,
  ) => {
    const pending = pendingById.get(event.data.id)
    if (!pending) return
    pendingById.delete(event.data.id)
    window.clearTimeout(pending.timer)
    if (!event.data.ok) {
      pending.reject(new Error(event.data.message))
      return
    }
    const total = nowMs() - pending.startedAt
    const computeMs = event.data.elapsedMs
    logInvoiceWork('worker-roundtrip', {
      kind: event.data.kind,
      totalMs: Math.round(total),
      computeMs: Math.round(computeMs),
      cloneMs: Math.max(0, Math.round(total - computeMs)),
    })
    markInvoiceWorkStage(null, 'worker-compute', {
      kind: event.data.kind,
      ms: Math.round(computeMs),
    })
    pending.resolve(event.data.result)
  }
  worker.onerror = (event) => {
    const error =
      event.error instanceof Error
        ? event.error
        : new Error(event.message || '변환 계산에 실패했습니다.')
    disposeWorker()
    for (const [id] of [...pendingById]) {
      rejectPending(id, error)
    }
  }
  sharedWorker = worker
  return worker
}

function runInvoiceStepInWorker<T>(
  request: InvoiceStepTransformWorkerRequest,
): CancellableCompute<T> {
  let cancel = () => {}
  const promise = new Promise<T>((resolve, reject) => {
    const worker = getSharedWorker()
    const startedAt = nowMs()
    const timer = window.setTimeout(() => {
      rejectPending(request.id, new Error('변환 계산이 너무 오래 걸립니다.'))
      disposeWorker()
    }, COMPUTE_TIMEOUT_MS)
    pendingById.set(request.id, {
      resolve: (value) => resolve(value as T),
      reject,
      startedAt,
      timer,
    })
    cancel = () => {
      rejectPending(request.id, new Error('변환 계산이 취소되었습니다.'))
    }
    markInvoiceWorkStage(null, 'worker-clone', { kind: request.kind })
    worker.postMessage(request)
  }) as CancellableCompute<T>
  promise.cancel = () => cancel()
  return promise
}

function shouldUseWorker(rowCount: number) {
  return (
    typeof Worker !== 'undefined' &&
    rowCount >= INVOICE_COMPUTE_WORKER_MIN_ROWS
  )
}

export function computeInvoiceProductNameStep(
  input: InvoiceProductNameStepInput,
): InvoiceProductNameStepResult | CancellableCompute<InvoiceProductNameStepResult> {
  if (!shouldUseWorker(input.sourceRows.length)) {
    return runInvoiceProductNameStep(input)
  }
  try {
    return runInvoiceStepInWorker<InvoiceProductNameStepResult>({
      id: nextRequestId++,
      kind: 'product',
      input,
    })
  } catch {
    return runInvoiceProductNameStep(input)
  }
}

export function computeInvoiceItemNameStep(
  input: InvoiceItemNameStepInput,
): InvoiceItemNameTransformation | CancellableCompute<InvoiceItemNameTransformation> {
  if (!shouldUseWorker(input.sourceRows.length)) {
    return runInvoiceItemNameStep(input)
  }
  try {
    return runInvoiceStepInWorker<InvoiceItemNameTransformation>({
      id: nextRequestId++,
      kind: 'item',
      input,
    })
  } catch {
    return runInvoiceItemNameStep(input)
  }
}

export function computeInvoiceProductNameStepOnMain(
  input: InvoiceProductNameStepInput,
) {
  return resolved(runInvoiceProductNameStep(input))
}

export function computeInvoiceItemNameStepOnMain(input: InvoiceItemNameStepInput) {
  return resolved(runInvoiceItemNameStep(input))
}
