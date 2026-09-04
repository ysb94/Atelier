/**
 * 송장 단계 계산 취소·세대·재계산 합침 검증.
 * 실행: npm run verify:invoice-step-compute
 */
import {
  canLeaveInvoiceFileCheck,
  formatInvoiceStepComputeError,
  holdInvoiceStepDepsKey,
  INVOICE_STEP_COMPUTE_CANCEL_MESSAGE,
  INVOICE_STEP_COMPUTE_TIMEOUT_MESSAGE,
  invoiceBackedUpExcludedRowNumbers,
  invoiceBackupConfirmButton,
  isCancelledInvoiceStepError,
  isInvoicePreConfirmReady,
  isInvoicePreloadFlowReady,
  isInvoiceWorkFlowReady,
  nextInvoiceStepGeneration,
  preserveInvoiceStepResult,
  shouldApplyInvoiceStepResult,
  shouldAutoCollectInvoiceAi,
  shouldAutoOpenInvoiceBackupDialog,
  shouldEnableHeldInvoiceStepCompute,
  shouldFinishInvoiceUploadPipeline,
  shouldHoldInvoiceStepRecompute,
  shouldRunDeferredInvoiceStep,
  shouldShowInvoiceStepBlockingState,
  shouldStartInvoiceItemNameAiCollect,
} from '@/lib/invoice/invoice-step-compute'
import { filterRowsByExcludedNumbers } from '@/lib/invoice/invoice-order-key'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import { INVOICE_WORK_LARGE_ROW_COUNT } from '@/lib/invoice/invoice-work-fixtures'
import { INVOICE_COMPUTE_WORKER_MIN_ROWS } from '@/lib/invoice/invoice-work-thresholds'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(
  INVOICE_COMPUTE_WORKER_MIN_ROWS === Number.POSITIVE_INFINITY,
  '40,000행 벤치 결과에 따라 계산 Worker를 우회한다',
)

assert(
  isCancelledInvoiceStepError(new Error(INVOICE_STEP_COMPUTE_CANCEL_MESSAGE)),
  '취소 오류를 인식한다',
)
assert(
  !isCancelledInvoiceStepError(new Error(INVOICE_STEP_COMPUTE_TIMEOUT_MESSAGE)),
  '타임아웃은 취소로 보지 않는다',
)

assert(nextInvoiceStepGeneration(3) === 4, '세대를 한 칸 올린다')
assert(shouldApplyInvoiceStepResult(4, 4), '현재 세대 결과만 적용한다')
assert(!shouldApplyInvoiceStepResult(3, 4), '이전 세대 결과는 버린다')

const applied: string[] = []
let generation = 0
function startCompute() {
  generation = nextInvoiceStepGeneration(generation)
  const started = generation
  return {
    finish(value: string) {
      if (shouldApplyInvoiceStepResult(started, generation)) {
        applied.push(value)
      }
    },
    cancel() {
      generation = nextInvoiceStepGeneration(generation)
    },
  }
}
const stale = startCompute()
stale.cancel()
const fresh = startCompute()
stale.finish('cancelled-33k')
fresh.finish('current')
assert(
  applied.join(',') === 'current',
  '취소된 대형 계산 응답은 무시하고 새 계산만 남긴다',
)

assert(
  preserveInvoiceStepResult({ rows: 33150 }, null)?.rows === 33150,
  '일시 오류에서 마지막 성공 결과를 유지한다',
)
assert(
  preserveInvoiceStepResult({ rows: 1 }, { rows: 2 })?.rows === 2,
  '새 성공 결과가 있으면 교체한다',
)

assert(
  shouldHoldInvoiceStepRecompute({ saving: true, criteriaSettled: true }),
  '저장 중에는 재계산을 미룬다',
)
assert(
  shouldHoldInvoiceStepRecompute({ saving: false, criteriaSettled: false }),
  'deferred 기준이 안정되기 전에는 재계산을 미룬다',
)
assert(
  !shouldHoldInvoiceStepRecompute({ saving: false, criteriaSettled: true }),
  '저장이 끝나고 기준이 안정되면 재계산한다',
)

function countComputes(
  events: Array<{ saving: boolean; settled: boolean; liveKey: string }>,
) {
  let heldKey = ''
  let lastKey = ''
  let computes = 0
  for (const event of events) {
    const hold = shouldHoldInvoiceStepRecompute({
      saving: event.saving,
      criteriaSettled: event.settled,
    })
    if (!hold) heldKey = event.liveKey
    const enabled = shouldEnableHeldInvoiceStepCompute({
      ready: true,
      hold,
      heldKey,
    })
    const depsKey = holdInvoiceStepDepsKey(event.liveKey, heldKey, hold)
    if (!enabled || depsKey === lastKey) continue
    computes += 1
    lastKey = depsKey
  }
  return computes
}

const largeRowKey = `file.xlsx\u0001${INVOICE_WORK_LARGE_ROW_COUNT}`
const saveBurst: Array<{
  saving: boolean
  settled: boolean
  liveKey: string
}> = [{ saving: false, settled: true, liveKey: `${largeRowKey}\u0001maps-0` }]
for (let index = 1; index <= 24; index += 1) {
  saveBurst.push({
    saving: true,
    settled: index % 3 !== 0,
    liveKey: `${largeRowKey}\u0001maps-${index}`,
  })
}
saveBurst.push({
  saving: false,
  settled: false,
  liveKey: `${largeRowKey}\u0001maps-final-lag`,
})
saveBurst.push({
  saving: false,
  settled: true,
  liveKey: `${largeRowKey}\u0001maps-final`,
})
assert(
  countComputes(saveBurst) === 2,
  '40,000행 기준 변경이 저장 중 쌓여도 계산은 초기 1회와 저장 후 1회만 한다',
)

assert(
  !shouldEnableHeldInvoiceStepCompute({
    ready: true,
    hold: true,
    heldKey: '',
  }),
  '얼린 키가 없으면 첫 deferred 대기 동안 계산하지 않는다',
)
assert(
  shouldEnableHeldInvoiceStepCompute({
    ready: true,
    hold: true,
    heldKey: 'maps-0',
  }),
  '저장 중에는 기존 키를 유지한 채 계산을 켜 둔다',
)

assert(
  shouldAutoCollectInvoiceAi({
    pipelineActive: true,
    computeReady: true,
    alreadySettled: false,
  }),
  '업로드 중 처음 준비되면 AI를 한 번 모은다',
)
assert(
  !shouldAutoCollectInvoiceAi({
    pipelineActive: true,
    computeReady: true,
    alreadySettled: true,
  }),
  '이미 모은 AI는 탭 재진입·재마운트에서 다시 시작하지 않는다',
)
assert(
  !shouldAutoCollectInvoiceAi({
    pipelineActive: false,
    computeReady: true,
    alreadySettled: false,
  }),
  '업로드 파이프라인이 아니면 자동 수집하지 않는다',
)

function sourceRow(rowNumber: number): SabangnetOrderRow {
  return {
    rowNumber,
    productName: `상품${rowNumber}`,
    itemName: '',
    quantity: '1',
    recipientName: '홍길동',
    recipientPhone: '010-1111-2222',
    recipientOtherPhone: '',
    shippingType: '',
    recipientAddress: '서울',
    shippingMessage: '',
    customerOrderNo: `ORD-${rowNumber}`,
    mallName: '스마트스토어',
    orderedAt: '2026-09-01 10:00:00',
    ownProductCode: '',
  }
}

const backupMatch = { rowNumbers: [1, 2] }
const allRows = [sourceRow(1), sourceRow(2), sourceRow(3), sourceRow(4)]
const preloadedWorkRows = filterRowsByExcludedNumbers(
  allRows,
  new Set(invoiceBackedUpExcludedRowNumbers({ match: backupMatch })),
)
assert(
  invoiceBackedUpExcludedRowNumbers({ match: backupMatch }).join(',') === '1,2',
  '확인 전에도 백업 행 번호를 제외 대상으로 쓴다',
)
assert(
  preloadedWorkRows.map((row) => row.rowNumber).join(',') === '3,4',
  '확인 전 계산은 제외 후 작업 행만 본다',
)
assert(
  preloadedWorkRows.map((row) => row.rowNumber).join(',') ===
    filterRowsByExcludedNumbers(
      allRows,
      new Set(invoiceBackedUpExcludedRowNumbers({ match: backupMatch })),
    )
      .map((row) => row.rowNumber)
      .join(','),
  '확인 후에도 같은 제외 결과를 다시 계산하지 않는다',
)

const preloadFlowReady = isInvoicePreloadFlowReady({
  backupLookupReady: true,
  workRowCount: preloadedWorkRows.length,
})
assert(preloadFlowReady, '백업 조회가 끝나면 확인 전에도 계산을 연다')
assert(
  !isInvoiceWorkFlowReady({
    preloadFlowReady,
    hasBackedUpMatch: true,
    backedUpExclusionAccepted: false,
  }),
  '확인 전에는 다음 단계로 가지 못한다',
)
assert(
  !canLeaveInvoiceFileCheck({
    headerReady: true,
    mallsReady: true,
    workFlowReady: false,
  }),
  '파일 확인 이탈은 중복 제외 동의가 있어야 한다',
)
assert(
  isInvoiceWorkFlowReady({
    preloadFlowReady,
    hasBackedUpMatch: true,
    backedUpExclusionAccepted: true,
  }),
  '확인 후에는 이미 계산된 작업 행으로 다음 단계로 간다',
)

assert(
  !isInvoicePreConfirmReady({
    backupLookupReady: true,
    workRowCount: 2,
    stagesSettled: true,
    productAiSettled: false,
    laterStagesSettled: true,
  }),
  '품목명 AI가 끝나기 전에는 확인 버튼이 비활성이다',
)
assert(
  invoiceBackupConfirmButton(false).disabled &&
    invoiceBackupConfirmButton(false).label === '준비 중...',
  '준비 전에는 확인 버튼을 비활성으로 둔다',
)
assert(
  isInvoicePreConfirmReady({
    backupLookupReady: true,
    workRowCount: 2,
    stagesSettled: true,
    productAiSettled: true,
    laterStagesSettled: true,
  }),
  '계산과 품목명 AI가 끝나면 확인 버튼을 연다',
)
assert(
  !invoiceBackupConfirmButton(true).disabled &&
    invoiceBackupConfirmButton(true).label === '제외하고 진행',
  '준비가 끝나면 제외하고 진행으로 바꾼다',
)
assert(
  !shouldAutoOpenInvoiceBackupDialog({
    isParsing: true,
    uploadPipeline: true,
    preConfirmReady: false,
    hasBackedUpMatch: true,
    accepted: false,
  }),
  '파싱 중에는 백업 제외 창을 열지 않는다',
)
assert(
  !shouldAutoOpenInvoiceBackupDialog({
    isParsing: false,
    uploadPipeline: true,
    preConfirmReady: true,
    hasBackedUpMatch: true,
    accepted: false,
  }),
  '업로드 파이프라인 중에는 백업 제외 창을 열지 않는다',
)
assert(
  !shouldAutoOpenInvoiceBackupDialog({
    isParsing: false,
    uploadPipeline: false,
    preConfirmReady: false,
    hasBackedUpMatch: true,
    accepted: false,
  }),
  '준비가 끝나기 전에는 백업 제외 창을 열지 않는다',
)
assert(
  !shouldAutoOpenInvoiceBackupDialog({
    isParsing: false,
    uploadPipeline: false,
    preConfirmReady: true,
    hasBackedUpMatch: true,
    accepted: true,
  }),
  '이미 수락한 뒤에는 백업 제외 창을 다시 열지 않는다',
)
assert(
  !shouldAutoOpenInvoiceBackupDialog({
    isParsing: false,
    uploadPipeline: false,
    preConfirmReady: true,
    hasBackedUpMatch: false,
    accepted: false,
  }),
  '중복이 없으면 백업 제외 창을 열지 않는다',
)
assert(
  shouldAutoOpenInvoiceBackupDialog({
    isParsing: false,
    uploadPipeline: false,
    preConfirmReady: true,
    hasBackedUpMatch: true,
    accepted: false,
  }),
  '파이프라인이 끝나고 준비가 되면 백업 제외 창을 연다',
)

assert(
  shouldFinishInvoiceUploadPipeline({
    headerReady: true,
    backupLookupReady: true,
    workRowCount: 2,
    exclusionSigAligned: true,
    stagesSettled: true,
    laterStagesSettled: true,
    productAiSettled: true,
  }),
  '업로드 파이프라인은 품목명 AI까지 끝나면 닫는다',
)
assert(
  !shouldStartInvoiceItemNameAiCollect({ userRequested: false }),
  '업로드 중에는 내품명 AI를 자동으로 시작하지 않는다',
)
assert(
  shouldStartInvoiceItemNameAiCollect({ userRequested: true }),
  '내품명 AI는 추천 모으기를 눌렀을 때만 실행한다',
)
assert(
  shouldRunDeferredInvoiceStep({
    uploadPipeline: true,
    stepIndex: 1,
    stageIndex: 8,
  }),
  '업로드 파이프라인 중에는 후속 단계를 미리 계산한다',
)
assert(
  !shouldRunDeferredInvoiceStep({
    uploadPipeline: false,
    stepIndex: 4,
    stageIndex: 5,
  }),
  '품목명 단계에서는 내품명 이후를 다시 계산하지 않는다',
)
assert(
  shouldRunDeferredInvoiceStep({
    uploadPipeline: false,
    stepIndex: 5,
    stageIndex: 5,
  }),
  '해당 단계에 들어가면 후속 계산을 연다',
)

assert(
  shouldShowInvoiceStepBlockingState({
    hasResult: true,
    computing: true,
    hasError: true,
  }) === 'keep',
  '마지막 성공 결과가 있으면 패널을 유지한다',
)
assert(
  shouldShowInvoiceStepBlockingState({
    hasResult: false,
    computing: true,
    hasError: false,
  }) === 'loading',
  '최초 계산 중에는 로딩을 보여 준다',
)
assert(
  shouldShowInvoiceStepBlockingState({
    hasResult: false,
    computing: false,
    hasError: true,
  }) === 'error',
  '최초 실패만 단계 진행을 막는다',
)

assert(
  formatInvoiceStepComputeError(INVOICE_STEP_COMPUTE_TIMEOUT_MESSAGE, 120_400)
    === `${INVOICE_STEP_COMPUTE_TIMEOUT_MESSAGE} (120초)`,
  '오류에 단계 소요 시간을 붙인다',
)

console.log('invoice-step-compute verify: ok')
