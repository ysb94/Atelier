export const INVOICE_STEP_COMPUTE_TIMEOUT_MS = 120_000
export const INVOICE_STEP_COMPUTE_TIMEOUT_MESSAGE =
  '변환 계산이 너무 오래 걸립니다.'
export const INVOICE_STEP_COMPUTE_CANCEL_MESSAGE =
  '변환 계산이 취소되었습니다.'

export function isCancelledInvoiceStepError(error: unknown) {
  return error instanceof Error && error.message.includes('취소')
}

export function nextInvoiceStepGeneration(current: number) {
  return current + 1
}

export function shouldApplyInvoiceStepResult(
  generation: number,
  currentGeneration: number,
) {
  return generation === currentGeneration
}

export function shouldHoldInvoiceStepRecompute(input: {
  saving: boolean
  criteriaSettled: boolean
}) {
  return input.saving || !input.criteriaSettled
}

export function holdInvoiceStepDepsKey(
  liveKey: string,
  heldKey: string,
  hold: boolean,
) {
  return hold && heldKey ? heldKey : liveKey
}

export function shouldEnableHeldInvoiceStepCompute(input: {
  ready: boolean
  hold: boolean
  heldKey: string
}) {
  if (!input.ready) return false
  if (input.hold && !input.heldKey) return false
  return true
}

export function formatInvoiceStepComputeError(
  message: string,
  elapsedMs: number,
) {
  const seconds = Math.max(1, Math.round(elapsedMs / 1000))
  return `${message} (${seconds}초)`
}

export function preserveInvoiceStepResult<T>(
  previous: T | null,
  next: T | null,
) {
  return next ?? previous
}

export function shouldAutoCollectInvoiceAi(input: {
  pipelineActive: boolean
  computeReady: boolean
  alreadySettled: boolean
}) {
  return input.pipelineActive && input.computeReady && !input.alreadySettled
}

export function shouldShowInvoiceStepBlockingState(input: {
  hasResult: boolean
  computing: boolean
  hasError: boolean
}) {
  if (input.hasResult) return 'keep'
  if (input.computing) return 'loading'
  if (input.hasError) return 'error'
  return 'empty'
}
