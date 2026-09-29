/**
 * 하차용 분할 순서와 A/B/C 적재방식 검증.
 * 실행: npx tsx src/lib/cargo/unload-stow.verify.ts
 */
import { queueUnloadSplitRows, splitUnloadStackRows } from './inbound'
import { assignUnloadStowLabels } from './unload-stow'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const queued = queueUnloadSplitRows([
  ['M1-원본', 'M1-분할1', 'M1-분할2'],
  ['M2-원본', 'M2-분할1', 'M2-분할2'],
  ['M3-원본'],
]).map((row) => row.value)

assert(
  queued.join('|') ===
    'M1-원본|M2-원본|M3-원본|M1-분할1|M2-분할1|M1-분할2|M2-분할2',
  '분할 행은 원본 뒤가 아니라 목록 맨 아래에 재귀적으로 추가된다',
)

const latestFull = splitUnloadStackRows(10, 16)
assert(
  latestFull.length === 2 &&
    latestFull[0]?.incomingBoxes === 0 &&
    latestFull[0]?.latestBoxes === 16 &&
    latestFull[1]?.incomingBoxes === 10 &&
    latestFull[1]?.latestBoxes === 0,
  '최신자리가 16이면 첫 행은 입고 0, 둘째 행이 입고 10이다',
)

const mixedOnly = splitUnloadStackRows(0, 16)
assert(
  mixedOnly.length === 1 &&
    mixedOnly[0]?.incomingBoxes === 0 &&
    mixedOnly[0]?.latestBoxes === 16,
  '입고가 0이면 최신자리 16이어도 한 행으로 남긴다',
)

const hiddenOriginal = queueUnloadSplitRows([
  ['M1-원본', 'M1-분할1'],
  [null, 'M2-NEW'],
  ['M3-원본'],
]).map((row) => row.value)
assert(
  hiddenOriginal.join('|') === 'M1-원본|M3-원본|M1-분할1|M2-NEW',
  '가려진 원본 행은 순서만 차지하고 결과에서는 빠진다',
)

const labels = assignUnloadStowLabels([
  { key: 'a-late-style', styleNo: 'M9000', boxSum: 16, incomingBoxes: 5 },
  { key: 'a-early-style', styleNo: 'M0001', boxSum: 9, incomingBoxes: 2 },
  { key: 'c-eight', styleNo: 'M9001', boxSum: 8, incomingBoxes: 8 },
  { key: 'c-five', styleNo: 'M0002', boxSum: 5, incomingBoxes: 5 },
  { key: 'c-odd', styleNo: 'M0003', boxSum: 7, incomingBoxes: 7 },
  { key: 'b-late-style', styleNo: 'M9002', boxSum: 4, incomingBoxes: 4 },
  { key: 'b-early-style', styleNo: 'M0004', boxSum: 1, incomingBoxes: 1 },
  { key: 'mixed', styleNo: 'M0005', boxSum: 6, incomingBoxes: 0 },
])

assert(labels.get('a-late-style') === 'A1', 'A는 현재 행 순서로 번호를 붙인다')
assert(labels.get('a-early-style') === 'A2', 'A는 M번호순으로 먼저 정렬하지 않는다')
assert(labels.get('c-eight') === 'C1', '첫 C 행은 C1이다')
assert(labels.get('c-five') === 'C1', '두 번째 C 행은 같은 C1이다')
assert(labels.get('c-odd') === 'C2', '홀수로 남은 C도 B로 바꾸지 않는다')
assert(labels.get('b-late-style') === '1B1', 'B도 현재 행 순서로 번호를 붙인다')
assert(labels.get('b-early-style') === '1B2', 'B는 M번호순으로 먼저 정렬하지 않는다')
assert(!labels.has('mixed'), '입고 박스가 없으면 적재방식을 비운다')

console.log('unload-stow.verify ok')
