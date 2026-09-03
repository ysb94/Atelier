/**
 * 송장 단계 계산 취소·세대·재계산 합침 검증.
 * 실행: npm run verify:invoice-step-compute
 */
import {
  formatInvoiceStepComputeError,
  holdInvoiceStepDepsKey,
  INVOICE_STEP_COMPUTE_CANCEL_MESSAGE,
  INVOICE_STEP_COMPUTE_TIMEOUT_MESSAGE,
  isCancelledInvoiceStepError,
  nextInvoiceStepGeneration,
  preserveInvoiceStepResult,
  shouldApplyInvoiceStepResult,
  shouldAutoCollectInvoiceAi,
  shouldEnableHeldInvoiceStepCompute,
  shouldHoldInvoiceStepRecompute,
  shouldShowInvoiceStepBlockingState,
} from '@/lib/invoice/invoice-step-compute'
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
