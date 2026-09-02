import { INVOICE_COMPUTE_WORKER_MIN_ROWS } from '@/lib/invoice/invoice-work-thresholds'
import {
  runInvoiceItemNameStep,
  runInvoiceProductNameStep,
  type InvoiceItemNameStepInput,
  type InvoiceProductNameStepInput,
  type InvoiceProductNameStepResult,
} from '@/lib/invoice/invoice-step-transform'
import type { InvoiceItemNameTransformation } from '@/lib/invoice/item-name-transform'
import type {
  InvoiceStepTransformWorkerRequest,
  InvoiceStepTransformWorkerResponse,
} from '@/lib/invoice/invoice-step-transform.worker'

const COMPUTE_TIMEOUT_MS = 120_000

let nextRequestId = 1

export type CancellableCompute<T> = Promise<T> & { cancel: () => void }

function resolved<T>(value: T): CancellableCompute<T> {
  const promise = Promise.resolve(value) as CancellableCompute<T>
  promise.cancel = () => {}
  return promise
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
    const timer = window.setTimeout(() => {
      worker.terminate()
      reject(new Error('변환 계산이 너무 오래 걸립니다.'))
    }, COMPUTE_TIMEOUT_MS)
    const finish = () => {
      window.clearTimeout(timer)
      worker.terminate()
    }
    cancel = () => {
      finish()
      reject(new Error('변환 계산이 취소되었습니다.'))
    }
    worker.onmessage = (
      event: MessageEvent<InvoiceStepTransformWorkerResponse>,
    ) => {
      if (event.data.id !== request.id) return
      finish()
      if (event.data.ok) resolve(event.data.result as T)
      else reject(new Error(event.data.message))
    }
    worker.onerror = (event) => {
      finish()
      reject(
        event.error instanceof Error
          ? event.error
          : new Error(event.message || '변환 계산에 실패했습니다.'),
      )
    }
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
