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

export function invoiceBackedUpExcludedRowNumbers(input: {
  match: { rowNumbers: readonly number[] } | null
}): number[] {
  if (!input.match || input.match.rowNumbers.length === 0) return []
  return [...input.match.rowNumbers]
}

export function isInvoicePreloadFlowReady(input: {
  backupLookupReady: boolean
  workRowCount: number
}) {
  return input.backupLookupReady && input.workRowCount > 0
}

export function isInvoiceWorkFlowReady(input: {
  preloadFlowReady: boolean
  hasBackedUpMatch: boolean
  backedUpExclusionAccepted: boolean
}) {
  return (
    input.preloadFlowReady &&
    (!input.hasBackedUpMatch || input.backedUpExclusionAccepted)
  )
}

export function canLeaveInvoiceFileCheck(input: {
  headerReady: boolean
  mallsReady: boolean
  workFlowReady: boolean
}) {
  return input.headerReady && input.mallsReady && input.workFlowReady
}

export function isInvoicePreConfirmReady(input: {
  backupLookupReady: boolean
  workRowCount: number
  stagesSettled: boolean
  productAiSettled: boolean
  laterStagesSettled: boolean
  exclusionSigAligned?: boolean
}) {
  if (!input.backupLookupReady) return false
  if (input.workRowCount === 0) return true
  if (input.exclusionSigAligned === false) return false
  return (
    input.stagesSettled &&
    input.productAiSettled &&
    input.laterStagesSettled
  )
}

export function invoiceBackupConfirmButton(ready: boolean): {
  disabled: boolean
  label: string
} {
  return ready
    ? { disabled: false, label: '제외하고 진행' }
    : { disabled: true, label: '준비 중...' }
}

export const INVOICE_BACKUP_LOOKUP_BUSY_LABEL =
  '이전 백업과 겹치는 주문을 확인하고 있습니다.'

export function shouldAutoOpenInvoiceBackupDialog(input: {
  isParsing: boolean
  uploadPipeline: boolean
  preConfirmReady: boolean
  hasBackedUpMatch: boolean
  accepted: boolean
}) {
  return (
    !input.isParsing &&
    !input.uploadPipeline &&
    input.preConfirmReady &&
    input.hasBackedUpMatch &&
    !input.accepted
  )
}

export function shouldFinishInvoiceUploadPipeline(input: {
  headerReady: boolean
  backupLookupReady: boolean
  workRowCount: number
  exclusionSigAligned: boolean
  stagesSettled: boolean
  laterStagesSettled: boolean
  productAiSettled: boolean
}) {
  if (!input.headerReady) return true
  if (!input.backupLookupReady) return false
  if (input.workRowCount === 0) return true
  return (
    input.exclusionSigAligned &&
    input.stagesSettled &&
    input.laterStagesSettled &&
    input.productAiSettled
  )
}

export function shouldStartInvoiceItemNameAiCollect(input: {
  userRequested: boolean
}) {
  return input.userRequested
}

export function shouldRunDeferredInvoiceStep(input: {
  uploadPipeline: boolean
  stepIndex: number
  stageIndex: number
}) {
  return input.uploadPipeline || input.stepIndex >= input.stageIndex
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
