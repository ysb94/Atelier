import { INVOICE_COMPUTE_WORKER_MIN_ROWS } from '@/lib/invoice/invoice-work-thresholds'
import {
  INVOICE_STEP_COMPUTE_CANCEL_MESSAGE,
  INVOICE_STEP_COMPUTE_TIMEOUT_MESSAGE,
  INVOICE_STEP_COMPUTE_TIMEOUT_MS,
} from '@/lib/invoice/invoice-step-compute'
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

let nextRequestId = 1

export type CancellableCompute<T> = Promise<T> & { cancel: () => void }

function resolved<T>(value: T): CancellableCompute<T> {
  const promise = Promise.resolve(value) as CancellableCompute<T>
  promise.cancel = () => {}
  return promise
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function runInvoiceStepInWorker<T>(
  request: InvoiceStepTransformWorkerRequest,
): CancellableCompute<T> {
  let cancel = () => {}
  const promise = new Promise<T>((resolve, reject) => {
    const worker = new Worker(
      new URL('./invoice-step-transform.worker.ts', import.meta.url),
      { type: 'module' },
    )
    const startedAt = nowMs()
    let settled = false
    const finish = () => {
      window.clearTimeout(timer)
      worker.terminate()
    }
    const settle = (apply: () => void) => {
      if (settled) return
      settled = true
      finish()
      apply()
    }
    const timer = window.setTimeout(() => {
      const total = nowMs() - startedAt
      logInvoiceWork('worker-timeout', {
        kind: request.kind,
        totalMs: Math.round(total),
      })
      settle(() => reject(new Error(INVOICE_STEP_COMPUTE_TIMEOUT_MESSAGE)))
    }, INVOICE_STEP_COMPUTE_TIMEOUT_MS)
    cancel = () => {
      settle(() => reject(new Error(INVOICE_STEP_COMPUTE_CANCEL_MESSAGE)))
    }
    worker.onmessage = (
      event: MessageEvent<InvoiceStepTransformWorkerResponse>,
    ) => {
      if (event.data.id !== request.id) return
      settle(() => {
        if (!event.data.ok) {
          reject(new Error(event.data.message))
          return
        }
        const total = nowMs() - startedAt
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
        resolve(event.data.result as T)
      })
    }
    worker.onerror = (event) => {
      settle(() =>
        reject(
          event.error instanceof Error
            ? event.error
            : new Error(event.message || '변환 계산에 실패했습니다.'),
        ),
      )
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
