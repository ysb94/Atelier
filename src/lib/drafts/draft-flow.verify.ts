/**
 * 대표 샘플 합격 뒤 컬러 샘플·촬영 대기 검증.
 * 실행: npx tsx src/lib/drafts/draft-flow.verify.ts
 */
import type { DraftColorRow } from '../types'
import {
  colorWorkOrderFileName,
  filledColorWorkOrders,
  isColorSampleOrdered,
  isColorSampleReadyForPhoto,
  markLatestColorSampleReturned,
  passLatestColorSampleRound,
  requestNextColorSampleRound,
  resolveColorSampleRounds,
  sanitizeColorWorkOrder,
  setColorWorkOrderShipped,
  startColorSamples,
} from './draft-flow'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function color(partial: Partial<DraftColorRow> & Pick<DraftColorRow, 'id'>): DraftColorRow {
  return {
    name: '',
    orderQty: null,
    sampleInProgress: false,
    sampleWorkOrderUrl: null,
    sampleWorkOrderName: '',
    sampleWorkOrderShipped: false,
    sampleWorkOrderShippedAt: null,
    ...partial,
  }
}

const colors = startColorSamples([
  color({ id: 'c1', name: 'Black', orderQty: 10 }),
  color({ id: 'c2' }),
])
assert(colors[0]?.sampleInProgress === true, '이름 있는 컬러는 샘플 진행')
assert(colors[1]?.sampleInProgress === false, '빈 컬러는 그대로')

assert(!isColorSampleOrdered({}), '발주 전에는 촬영 목록에 안 넣는다')
assert(
  isColorSampleOrdered({ orderInProgress: true }),
  '컬러샘플 발주 완료면 목록에 넣는다',
)
assert(
  isColorSampleReadyForPhoto({ orderInProgress: true }),
  '발주 완료고 촬영 전이면 대기',
)
assert(
  !isColorSampleReadyForPhoto({
    orderInProgress: true,
    photoSampleDone: true,
  }),
  '촬영 완료는 대기에서 뺀다',
)

const withFile = sanitizeColorWorkOrder(
  color({
    id: 'c3',
    name: 'Silver',
    sampleWorkOrderUrl: '  data:file,c  ',
    sampleWorkOrderName: ' silver.xlsx ',
  }),
)
assert(withFile.sampleWorkOrderUrl === 'data:file,c', '컬러 지시서 URL을 정리한다')
assert(withFile.sampleInProgress === true, '컬러 지시서가 있으면 샘플 진행')
assert(
  colorWorkOrderFileName(withFile) === 'silver.xlsx',
  '올린 파일명을 쓴다',
)
assert(filledColorWorkOrders([withFile, color({ id: 'c4' })]).length === 1, '파일 있는 컬러만')

const shipped = setColorWorkOrderShipped([withFile], 'c3', true, '2026-09-08T00:00:00.000Z')
assert(shipped[0]?.sampleWorkOrderShipped === true, '그 컬러만 발송 완료')
assert(
  setColorWorkOrderShipped(shipped, 'c3', false)[0]?.sampleWorkOrderShipped === false,
  '발송을 되돌릴 수 있다',
)

const legacyRounds = resolveColorSampleRounds({
  specs: { colorSampleRequestedAt: '2026-10-14T00:00:00.000Z', colorSampleRounds: [] },
  colors: [withFile],
})
assert(legacyRounds.length === 1 && legacyRounds[0]?.round === 1, '파일이 있으면 1차로 본다')
const returned = markLatestColorSampleReturned(legacyRounds, '2026-10-14T03:00:00.000Z')
assert(returned[0]?.returnedAt === '2026-10-14T03:00:00.000Z', '회신일을 최신 차수에 남긴다')
const passed = passLatestColorSampleRound(returned)
assert(passed[0]?.passed === true, '돌아온 컬러 샘플만 합격한다')
const again = requestNextColorSampleRound(returned)
assert(again.length === 2 && again[1]?.round === 2, '같은 파일로 2차를 연다')
assert(again[1]?.url === returned[0]?.url, '2차도 같은 작업지시서 파일을 쓴다')
assert(again[1]?.shippedAt === null && again[1]?.returnedAt === null, '2차는 작업지시서를 다시 보내지 않는다')
assert(again[0]?.returnedAt, '이전 차수 회신일은 남긴다')
assert(passLatestColorSampleRound(again)[1]?.passed !== true, '회신 전 차수는 합격하지 않는다')

console.log('draft-flow.verify ok')
