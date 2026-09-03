/// <reference lib="webworker" />
import {
  runInvoiceItemNameStep,
  runInvoiceProductNameStep,
  type InvoiceItemNameStepInput,
  type InvoiceProductNameStepInput,
  type InvoiceProductNameStepResult,
} from '@/lib/invoice/invoice-step-transform'
import type { InvoiceItemNameTransformation } from '@/lib/invoice/item-name-transform'

export type InvoiceStepTransformWorkerRequest =
  | { id: number; kind: 'product'; input: InvoiceProductNameStepInput }
  | { id: number; kind: 'item'; input: InvoiceItemNameStepInput }

export type InvoiceStepTransformWorkerResponse =
  | {
      id: number
      ok: true
      kind: 'product'
      result: InvoiceProductNameStepResult
      elapsedMs: number
    }
  | {
      id: number
      ok: true
      kind: 'item'
      result: InvoiceItemNameTransformation
      elapsedMs: number
    }
  | { id: number; ok: false; message: string }

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

self.onmessage = (
  event: MessageEvent<InvoiceStepTransformWorkerRequest>,
) => {
  const { id, kind, input } = event.data
  const startedAt = nowMs()
  try {
    if (kind === 'product') {
      self.postMessage({
        id,
        ok: true,
        kind,
        result: runInvoiceProductNameStep(input),
        elapsedMs: nowMs() - startedAt,
      } satisfies InvoiceStepTransformWorkerResponse)
      return
    }
    self.postMessage({
      id,
      ok: true,
      kind,
      result: runInvoiceItemNameStep(input),
      elapsedMs: nowMs() - startedAt,
    } satisfies InvoiceStepTransformWorkerResponse)
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : '이 단계를 계산하지 못했습니다.',
    } satisfies InvoiceStepTransformWorkerResponse)
  }
}
