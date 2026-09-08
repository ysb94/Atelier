/**
 * 샘플 작업 지시서 차수·발송 완료 검증.
 * 실행: npx tsx src/lib/drafts/sample-work-order.verify.ts
 */
import {
  addNextSampleWorkOrder,
  canAddNextSampleWorkOrder,
  canPassLatestSampleWorkOrder,
  draftHasSampleWorkOrder,
  failLatestSampleWorkOrder,
  latestFilledSampleWorkOrder,
  legacyWorkOrderFields,
  normalizeSampleWorkOrders,
  previousSampleFailReason,
  samplePhase,
  samplePhaseLabel,
  sampleWorkOrderLabel,
  sanitizeSampleWorkOrders,
  setLatestSampleWorkOrderPassed,
  setLatestSampleWorkOrderShipped,
  setSampleWorkOrderShipped,
  withPendingNextSampleWorkOrder,
} from './sample-work-order'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(sampleWorkOrderLabel(2) === '2차', '차수 라벨')

const first = normalizeSampleWorkOrders(null, 'data:file,a', 'a.xlsx')
assert(first.length === 1 && first[0]?.url === 'data:file,a', '예전 1차 파일을 차수로 옮긴다')
assert(samplePhase(first) === 'in_progress', '올리면 진행중')
assert(samplePhaseLabel(first) === '1차 샘플 진행중', '1차 진행 라벨')
assert(!canAddNextSampleWorkOrder(first), '발송 전에는 다음 차수를 못 올린다')

const shipped = setLatestSampleWorkOrderShipped(first, true, '2026-09-08T00:00:00.000Z')
assert(shipped[0]?.shipped === true, '최신 차수를 발송 완료한다')
assert(samplePhaseLabel(shipped) === '1차 샘플 발송완료', '1차 발송 라벨')
assert(canAddNextSampleWorkOrder(shipped), '발송 완료 뒤 다음 차수를 올린다')
assert(canPassLatestSampleWorkOrder(shipped), '발송 완료 뒤 합격할 수 있다')

const passed = setLatestSampleWorkOrderPassed(shipped, true, '2026-09-08T01:00:00.000Z')
assert(samplePhase(passed) === 'passed', '합격하면 샘플 단계가 끝난다')
assert(samplePhaseLabel(passed) === '1차 샘플 합격', '1차 합격 라벨')
assert(!canAddNextSampleWorkOrder(passed), '합격 뒤에는 다음 차수를 안 올린다')

const withSecond = addNextSampleWorkOrder(shipped)
assert(withSecond.length === 2 && withSecond[1]?.round === 2, '2차 칸을 만든다')
assert(
  latestFilledSampleWorkOrder(withSecond)?.round === 1,
  '빈 2차는 아직 최신이 아니다',
)

const saved = sanitizeSampleWorkOrders(withSecond)
assert(saved.length === 1, '빈 다음 차수는 저장하지 않는다')

const failed = failLatestSampleWorkOrder(shipped, '  소매 기장 짧게  ')
assert(failed[0]?.failReason === '소매 기장 짧게', '불합격 사유를 남긴다')
assert(failed.length === 2 && !failed[1]?.url, '사유 저장 뒤 다음 칸을 연다')
assert(
  !canAddNextSampleWorkOrder(failed),
  '이미 불합격한 차수는 다시 다음 칸을 열지 않는다',
)
assert(
  previousSampleFailReason(failed, failed[1]!.id) === '소매 기장 짧게',
  '다음 칸에서 이전 불합격 사유를 본다',
)
assert(
  withPendingNextSampleWorkOrder(sanitizeSampleWorkOrders(failed)).length === 2,
  '저장 뒤에도 다음 업로드 칸을 다시 붙인다',
)
assert(
  failLatestSampleWorkOrder(shipped, '   ').length === 1,
  '사유 없이 불합격하지 않는다',
)

const both = sanitizeSampleWorkOrders([
  ...shipped,
  { id: 'swo-2', round: 2, url: 'data:file,b', name: 'b.xlsx', shipped: false, shippedAt: null, passed: false, passedAt: null, failReason: '' },
])
assert(both.length === 2 && both[1]?.round === 2, '2차까지 저장한다')
assert(legacyWorkOrderFields(both).sampleWorkOrderName === 'b.xlsx', '레거시 필드는 최신 차수')
assert(
  latestFilledSampleWorkOrder(both)?.shipped === false,
  '2차가 올라오면 다시 발송 전이다',
)
assert(samplePhaseLabel(both) === '2차 샘플 진행중', '2차 진행 라벨')
assert(
  setSampleWorkOrderShipped(both, 'swo-2', true)[1]?.shipped === true,
  '특정 행만 발송 완료한다',
)

assert(draftHasSampleWorkOrder({ sampleWorkOrders: both }), '차수가 있으면 목록에 넣는다')
assert(
  draftHasSampleWorkOrder({
    sampleWorkOrders: [],
    sampleWorkOrderUrl: '',
    colors: [{ sampleWorkOrderUrl: 'data:file,c' }],
  }),
  '컬러 지시서만 있어도 목록에 넣는다',
)
assert(
  !draftHasSampleWorkOrder({ sampleWorkOrders: [], sampleWorkOrderUrl: '' }),
  '없으면 목록에서 뺀다',
)

console.log('sample-work-order.verify ok')
