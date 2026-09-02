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
  | { id: number; ok: true; kind: 'product'; result: InvoiceProductNameStepResult }
  | { id: number; ok: true; kind: 'item'; result: InvoiceItemNameTransformation }
  | { id: number; ok: false; message: string }

self.onmessage = (
  event: MessageEvent<InvoiceStepTransformWorkerRequest>,
) => {
  const { id, kind, input } = event.data
  try {
    if (kind === 'product') {
      self.postMessage({
        id,
        ok: true,
        kind,
        result: runInvoiceProductNameStep(input),
      } satisfies InvoiceStepTransformWorkerResponse)
      return
    }
    self.postMessage({
      id,
      ok: true,
      kind,
      result: runInvoiceItemNameStep(input),
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
