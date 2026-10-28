/**
 * 샘플 작업 지시서 차수·발송 완료 검증.
 * 실행: npx tsx src/lib/drafts/sample-work-order.verify.ts
 */
import {
  addNextSampleWorkOrder,
  attachSampleWorkOrderFile,
  canAddNextSampleWorkOrder,
  canPassLatestSampleWorkOrder,
  draftHasSampleWorkOrder,
  failLatestSampleWorkOrder,
  latestFilledSampleWorkOrder,
  legacyWorkOrderFields,
  normalizeSampleWorkOrders,
  previousSampleFailReason,
  attachOpenSampleWorkOrder,
  requestNextSampleRound,
  sampleHistoryDay,
  sampleElapsedDays,
  sheetDay,
  sheetRegisteredDay,
  samplePhase,
  sampleTripSpanDays,
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

const attached = attachSampleWorkOrderFile(
  [],
  { url: 'data:file,attached', name: 'attached.xlsx' },
  '2026-05-27T00:00:00.000Z',
)
assert(
  attached[0]?.url === 'data:file,attached' &&
    attached[0]?.name === 'attached.xlsx' &&
    attached[0]?.shipped === false &&
    attached[0]?.shippedAt === '2026-05-27T00:00:00.000Z' &&
    attached[0]?.returnedAt == null,
  '업로드하면 요청일을 남기고 반송일은 비운다',
)

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
  { id: 'swo-2', round: 2, url: 'data:file,b', name: 'b.xlsx', shipped: false, shippedAt: null, returnedAt: null, passed: false, passedAt: null, failReason: '', assigneeId: null, assigneeName: '', fileCheckedAt: null },
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

const pendingWithUploadDate = sanitizeSampleWorkOrders([
  {
    id: 'swo-upload',
    round: 1,
    url: 'data:file,old',
    name: 'old.xlsx',
    shipped: false,
    shippedAt: '2026-09-08T00:00:00.000Z',
    returnedAt: null,
    passed: false,
    passedAt: null,
    failReason: '',
    assigneeId: null,
    assigneeName: '',
    fileCheckedAt: null,
  },
])
const marked = setSampleWorkOrderShipped(
  pendingWithUploadDate,
  'swo-upload',
  true,
  '2026-10-14T10:08:00.000Z',
)
assert(
  marked[0]?.shipped === true &&
    marked[0]?.shippedAt === '2026-09-08T00:00:00.000Z' &&
    marked[0]?.returnedAt === '2026-10-14T10:08:00.000Z',
  '발송 완료는 요청일을 유지하고 반송일만 기록한다',
)
const kept = setSampleWorkOrderShipped(
  marked,
  'swo-upload',
  true,
  '2026-10-15T00:00:00.000Z',
)
assert(
  kept[0]?.shippedAt === '2026-09-08T00:00:00.000Z' &&
    kept[0]?.returnedAt === '2026-10-14T10:08:00.000Z',
  '이미 기록한 요청일과 반송일은 유지한다',
)
const legacyShipped = sanitizeSampleWorkOrders([
  {
    id: 'swo-legacy',
    round: 1,
    url: 'data:file,legacy',
    name: 'legacy.xlsx',
    shipped: true,
    shippedAt: '2026-09-08T00:00:00.000Z',
    returnedAt: null,
    passed: false,
    passedAt: null,
    failReason: '',
    assigneeId: null,
    assigneeName: '',
    fileCheckedAt: null,
  },
])
assert(
  legacyShipped[0]?.shippedAt === '2026-09-08T00:00:00.000Z' &&
    legacyShipped[0]?.returnedAt == null,
  '반송일이 없는 예전 기록에는 반송일을 만들지 않는다',
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

const rerequested = requestNextSampleRound(
  [
    {
      id: 'swo-back',
      round: 1,
      url: 'data:file,same',
      name: 'same.xlsx',
      shipped: true,
      shippedAt: '2026-10-14T08:00:00.000Z',
      returnedAt: '2026-10-14T10:00:00.000Z',
      passed: false,
      passedAt: null,
      failReason: '',
      assigneeId: 'staff-1',
      assigneeName: '중국담당',
      fileCheckedAt: '2026-10-14T09:00:00.000Z',
    },
  ],
  { url: 'data:file,second', name: 'second.xlsx' },
  '2026-10-14T11:00:00.000Z',
)
assert(rerequested.length === 2 && rerequested[1]?.round === 2, '재요청은 2차로 넘긴다')
assert(
  rerequested[1]?.url === 'data:file,second' &&
    rerequested[1]?.name === 'second.xlsx' &&
    rerequested[1]?.shippedAt === '2026-10-14T11:00:00.000Z' &&
    rerequested[1]?.returnedAt == null &&
    rerequested[0]?.url === 'data:file,same' &&
    rerequested[0]?.returnedAt === '2026-10-14T10:00:00.000Z',
  '재요청은 새로 첨부한 작업지시서로 요청하고 이전 파일은 남긴다',
)
assert(requestNextSampleRound(rerequested.slice(0, 1), { url: ' ', name: 'empty.xlsx' }).length === 1, '파일이 없으면 차수를 열지 않는다')
const opened = requestNextSampleRound(rerequested.slice(0, 1), { url: 'data:file,open', name: 'open.xlsx' }, '2026-10-14T11:00:00.000Z').map((order, index) => index === 1 ? { ...order, shippedAt: null } : order)
const attachedOpen = attachOpenSampleWorkOrder(opened, { url: 'data:file,real', name: 'real.xlsx' }, '2026-10-14T12:00:00.000Z')
assert(attachedOpen[1]?.url === 'data:file,real' && attachedOpen[1]?.shippedAt === '2026-10-14T12:00:00.000Z' && attachedOpen[0]?.url === 'data:file,same', '요청 전 차수에만 새 작업지시서를 붙인다')

assert(sampleTripSpanDays('2026-10-14T11:32:00.000Z', '2026-10-14T11:48:00.000Z') === 0, '같은 날 회신은 0일')
assert(sampleTripSpanDays('2026-10-14T11:32:00.000Z', '2026-10-17T01:00:00.000Z') === 3, '보낸 날부터 온 날까지 일수')
assert(sampleTripSpanDays('2026-10-14T11:32:00.000Z', null) == null, '아직 오지 않으면 일수를 비운다')
assert(sampleHistoryDay('2026-10-14T11:32:00.000Z') === '2026.10.14', '이력 날짜')
assert(sheetRegisteredDay('2026-10-14T11:32:00.000Z') === '26.10.14', '등록일')
assert(sheetRegisteredDay('') === '', '등록일이 없으면 비운다')
const dateOnlyShipment = { ...attached[0]!, shipped: false, returnedAt: '2026-10-28 10:00:00.123456+00' }
const restoredShipment = normalizeSampleWorkOrders([dateOnlyShipment])
assert(restoredShipment[0]?.shipped === true, '서버가 발송일만 저장해도 발송 완료로 조회한다')
assert(restoredShipment[0]?.returnedAt === dateOnlyShipment.returnedAt, '실제 중국 발송일을 보존한다')
assert(restoredShipment[0]?.receivedAt == null && !restoredShipment[0]?.passed, '발송 완료를 실물 수령이나 합격으로 취급하지 않는다')
assert(sanitizeSampleWorkOrders([dateOnlyShipment])[0]?.shipped === true, '이후 기획안 저장에서도 발송 상태를 보존한다')
assert(sanitizeSampleWorkOrders([dateOnlyShipment])[0]?.returnedAt === dateOnlyShipment.returnedAt, '이후 저장 시 발송일이 사라지지 않는다')
assert(normalizeSampleWorkOrders([{ ...dateOnlyShipment, returnedAt: '잘못된 날짜' }])[0]?.shipped === false, '잘못된 날짜로 발송 완료를 만들지 않는다')
assert(normalizeSampleWorkOrders([{ ...dateOnlyShipment, returnedAt: null }])[0]?.shipped === false, '발송일이 없는 요청은 대기로 유지한다')
const databaseTimestamp = '2026-10-28 10:17:23.538142+00'
const isoTimestamp = '2026-10-28T10:17:23.538Z'
assert(sampleHistoryDay(databaseTimestamp) === sampleHistoryDay(isoTimestamp), '실제 DB 날짜 형식이 ISO와 같은 날짜로 표시된다')
assert(sampleHistoryDay(databaseTimestamp) !== '', '저장된 중국 발송일을 날짜 없음으로 표시하지 않는다')
assert(sheetDay(databaseTimestamp) === sheetDay(isoTimestamp), '샘플 화살표의 짧은 날짜도 DB 형식을 읽는다')
assert(sampleElapsedDays(databaseTimestamp, new Date('2026-10-30T01:00:00Z')) === sampleElapsedDays(isoTimestamp, new Date('2026-10-30T01:00:00Z')), '경과일도 같은 날짜 기준을 쓴다')
assert(sampleTripSpanDays('2026-10-26 10:00:00.123456+00', databaseTimestamp) === 2, 'DB 형식의 등록일·발송일 사이 일수 계산')
assert(sampleHistoryDay('2026-10-28 23:30:00.123456+00') === sampleHistoryDay('2026-10-28T23:30:00.123Z'), '시차로 날짜가 바뀌어도 ISO와 동일하게 처리')
assert(sampleHistoryDay('2026-10-28 19:17:23.538142+09') === sampleHistoryDay(isoTimestamp), 'DB의 짧은 +09 시차를 처리')
assert(sheetDay('2026-10-28') === '10.28', '기존 날짜 전용 입력은 그대로 표시')
assert(sampleHistoryDay('2026-02-30') === '', '유효하지 않은 날짜를 임의 날짜로 만들지 않는다')
assert(sampleHistoryDay('') === '' && sheetDay(null) === '' && sampleElapsedDays('잘못된 날짜') === null, '누락·잘못된 값은 비워 둔다')
console.log('sample-work-order.verify ok')
