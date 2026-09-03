import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import {
  formatInvoiceStepComputeError,
  holdInvoiceStepDepsKey,
  isCancelledInvoiceStepError,
  nextInvoiceStepGeneration,
  preserveInvoiceStepResult,
  shouldApplyInvoiceStepResult,
  shouldEnableHeldInvoiceStepCompute,
} from '@/lib/invoice/invoice-step-compute'
import {
  logInvoiceWork,
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

export function useHeldInvoiceStepDepsKey(
  liveKey: string,
  hold: boolean,
  options?: { record?: boolean; resetKey?: string },
) {
  const heldRef = useRef('')
  const resetKeyRef = useRef(options?.resetKey ?? '')
  const resetKey = options?.resetKey ?? ''
  if (resetKeyRef.current !== resetKey) {
    resetKeyRef.current = resetKey
    heldRef.current = ''
  }
  if (!hold && (options?.record ?? true)) heldRef.current = liveKey
  const heldKey = heldRef.current
  return {
    depsKey: holdInvoiceStepDepsKey(liveKey, heldKey, hold),
    holdEnabled: shouldEnableHeldInvoiceStepCompute({
      ready: true,
      hold,
      heldKey,
    }),
  }
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

export function useInvoiceStepCompute<T>({
  enabled,
  depsKey,
  resetKey = '',
  compute,
  label,
  jobRef,
  stage,
}: {
  enabled: boolean
  depsKey: string
  resetKey?: string
  compute: () => T | Promise<T> | CancellableCompute<T>
  label?: string
  jobRef?: MutableRefObject<InvoiceWorkJob | null>
  stage?: InvoiceWorkStage
}): {
  status: InvoiceStepComputeStatus
  result: T | null
  error: string | null
  retry: () => void
} {
  const [version, setVersion] = useState(0)
  const [retryToken, setRetryToken] = useState(0)
  const storeRef = useRef<{
    key: string
    retryToken: number
    result: T | null
    error: string | null
    status: InvoiceStepComputeStatus
  }>({
    key: '',
    retryToken: 0,
    result: null,
    error: null,
    status: 'idle',
  })
  const generationRef = useRef(0)
  const resetKeyRef = useRef(resetKey)
  if (resetKeyRef.current !== resetKey) {
    resetKeyRef.current = resetKey
    generationRef.current = nextInvoiceStepGeneration(generationRef.current)
    storeRef.current = {
      key: '',
      retryToken,
      result: null,
      error: null,
      status: 'idle',
    }
  }
  const computeRef = useRef(compute)
  computeRef.current = compute

  const retry = useCallback(() => {
    setRetryToken((value) => value + 1)
  }, [])

  useEffect(() => {
    if (!enabled) return
    const current = storeRef.current
    if (
      current.key === depsKey &&
      current.status === 'ready' &&
      current.retryToken === retryToken
    ) {
      return
    }

    const generation = nextInvoiceStepGeneration(generationRef.current)
    generationRef.current = generation
    storeRef.current = {
      key: depsKey,
      retryToken,
      result: current.result,
      error: null,
      status: 'computing',
    }
    setVersion((value) => value + 1)

    let pending: unknown = null
    const timer = window.setTimeout(() => {
      if (!shouldApplyInvoiceStepResult(generation, generationRef.current)) {
        return
      }
      const startedAt =
        typeof performance !== 'undefined' ? performance.now() : Date.now()
      const apply = (result: T) => {
        if (!shouldApplyInvoiceStepResult(generation, generationRef.current)) {
          return
        }
        if (stage) markInvoiceWorkStage(jobRef?.current, stage)
        storeRef.current = {
          key: depsKey,
          retryToken,
          result,
          error: null,
          status: 'ready',
        }
        setVersion((value) => value + 1)
      }
      const fail = (error: unknown) => {
        if (!shouldApplyInvoiceStepResult(generation, generationRef.current)) {
          return
        }
        if (isCancelledInvoiceStepError(error)) return
        const elapsedMs = Math.round(
          (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
            startedAt,
        )
        const message =
          error instanceof Error
            ? error.message
            : '이 단계를 계산하지 못했습니다.'
        logInvoiceWork('step-compute-error', {
          label,
          elapsedMs,
        })
        storeRef.current = {
          key: depsKey,
          retryToken,
          result: preserveInvoiceStepResult(storeRef.current.result, null),
          error: formatInvoiceStepComputeError(message, elapsedMs),
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
  }, [depsKey, enabled, jobRef, label, resetKey, retryToken, stage])

  void version
  const store = storeRef.current
  const matches = store.key === depsKey
  const ready = matches && store.status === 'ready'
  const failed = matches && store.status === 'error'
  const status: InvoiceStepComputeStatus = !enabled
    ? ready
      ? 'ready'
      : store.result
        ? 'ready'
        : 'idle'
    : ready
      ? 'ready'
      : failed
        ? 'error'
        : 'computing'

  return {
    status,
    result: store.result,
    error: matches ? store.error : null,
    retry,
  }
}
