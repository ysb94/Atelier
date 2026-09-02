import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import {
  markInvoiceWorkStage,
  timeInvoiceWork,
  timeInvoiceWorkAsync,
  type InvoiceWorkJob,
  type InvoiceWorkStage,
} from '@/lib/invoice/invoice-work-perf'
import type { CancellableCompute } from '@/lib/invoice/invoice-step-transform-worker'

export type InvoiceStepComputeStatus = 'idle' | 'computing' | 'ready' | 'error'

export function invoiceStepDepsKey(
  parts: Array<string | number | boolean | null | undefined>,
) {
  return parts.map((part) => String(part ?? '')).join('\u0001')
}

function isThenable<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return typeof value === 'object' && value !== null && 'then' in value
}

function cancelCompute(value: unknown) {
  if (
    value &&
    typeof value === 'object' &&
    'cancel' in value &&
    typeof value.cancel === 'function'
  ) {
    value.cancel()
  }
}

function isCancelledError(error: unknown) {
  return error instanceof Error && error.message.includes('취소')
}

export function useInvoiceStepCompute<T>({
  enabled,
  depsKey,
  compute,
  label,
  jobRef,
  stage,
}: {
  enabled: boolean
  depsKey: string
  compute: () => T | Promise<T> | CancellableCompute<T>
  label?: string
  jobRef?: MutableRefObject<InvoiceWorkJob | null>
  stage?: InvoiceWorkStage
}): {
  status: InvoiceStepComputeStatus
  result: T | null
  error: string | null
} {
  const [version, setVersion] = useState(0)
  const storeRef = useRef<{
    key: string
    result: T | null
    error: string | null
    status: InvoiceStepComputeStatus
  }>({
    key: '',
    result: null,
    error: null,
    status: 'idle',
  })
  const generationRef = useRef(0)
  const computeRef = useRef(compute)
  computeRef.current = compute

  useEffect(() => {
    if (!enabled) return
    const current = storeRef.current
    if (current.key === depsKey && current.status === 'ready') return

    const generation = generationRef.current + 1
    generationRef.current = generation
    storeRef.current = {
      key: depsKey,
      result: current.key === depsKey ? current.result : null,
      error: null,
      status: 'computing',
    }
    setVersion((value) => value + 1)

    let pending: unknown = null
    const timer = window.setTimeout(() => {
      if (generation !== generationRef.current) return
      const apply = (result: T) => {
        if (generation !== generationRef.current) return
        if (stage) markInvoiceWorkStage(jobRef?.current, stage)
        storeRef.current = {
          key: depsKey,
          result,
          error: null,
          status: 'ready',
        }
        setVersion((value) => value + 1)
      }
      const fail = (error: unknown) => {
        if (generation !== generationRef.current) return
        if (isCancelledError(error)) return
        storeRef.current = {
          key: depsKey,
          result: null,
          error:
            error instanceof Error
              ? error.message
              : '이 단계를 계산하지 못했습니다.',
          status: 'error',
        }
        setVersion((value) => value + 1)
      }
      try {
        const value = computeRef.current()
        pending = value
        if (isThenable(value)) {
          void timeInvoiceWorkAsync(
            label ?? 'step-compute',
            () => Promise.resolve(value),
            jobRef?.current,
          ).then(apply, fail)
          return
        }
        apply(
          timeInvoiceWork(
            label ?? 'step-compute',
            () => value,
            jobRef?.current,
          ),
        )
      } catch (error) {
        fail(error)
      }
    }, 0)

    return () => {
      window.clearTimeout(timer)
      cancelCompute(pending)
    }
  }, [depsKey, enabled, jobRef, label, stage])

  void version
  const store = storeRef.current
  const matches = store.key === depsKey
  const ready = matches && store.status === 'ready'
  const failed = matches && store.status === 'error'
  const status: InvoiceStepComputeStatus = !enabled
    ? ready
      ? 'ready'
      : 'idle'
    : ready
      ? 'ready'
      : failed
        ? 'error'
        : 'computing'

  return {
    status,
    result: matches ? store.result : null,
    error: matches ? store.error : null,
  }
}
