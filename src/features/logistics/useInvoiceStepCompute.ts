import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import {
  markInvoiceWorkStage,
  timeInvoiceWork,
  type InvoiceWorkJob,
  type InvoiceWorkStage,
} from '@/lib/invoice/invoice-work-perf'

export type InvoiceStepComputeStatus = 'idle' | 'computing' | 'ready' | 'error'

export function invoiceStepDepsKey(
  parts: Array<string | number | boolean | null | undefined>,
) {
  return parts.map((part) => String(part ?? '')).join('\u0001')
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
  compute: () => T
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

    const timer = window.setTimeout(() => {
      if (generation !== generationRef.current) return
      try {
        const result = timeInvoiceWork(
          label ?? 'step-compute',
          () => computeRef.current(),
          jobRef?.current,
        )
        if (generation !== generationRef.current) return
        if (stage) markInvoiceWorkStage(jobRef?.current, stage)
        storeRef.current = {
          key: depsKey,
          result,
          error: null,
          status: 'ready',
        }
        setVersion((value) => value + 1)
      } catch (error) {
        if (generation !== generationRef.current) return
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
    }, 0)

    return () => {
      window.clearTimeout(timer)
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
