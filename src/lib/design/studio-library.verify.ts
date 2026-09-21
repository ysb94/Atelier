/**
 * 스튜디오 요청 첨부 제한 검증.
 * 실행: npx tsx src/lib/design/studio-library.verify.ts
 */
import { attachAssetsToRequest, REQUEST_ATTACH_LIMIT } from './studio-library.ts'
import { newStudio } from './styled-studio.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const empty = newStudio()
const first = attachAssetsToRequest(empty, 'new', ['a', 'b'])
assert(first.leftover === 0, '여유 있으면 leftover 0')
assert(Object.keys(first.editInputs.new ?? {}).length === 2, '두 장을 현재 요청에 첨부')

const fullIds = Array.from({ length: REQUEST_ATTACH_LIMIT }, (_, index) => `full-${index}`)
const full = attachAssetsToRequest({ ...empty, editInputs: { new: Object.fromEntries(fullIds.map((id) => [id, '이번 요청에서 용도 해석'])) } }, 'new', ['extra-1', 'extra-2'])
assert(full.leftover === 2, '14장이 이미 있으면 초과분은 leftover')
assert(Object.keys(full.editInputs.new ?? {}).length === REQUEST_ATTACH_LIMIT, '첨부는 14장을 넘기지 않는다')

const again = attachAssetsToRequest({ ...empty, editInputs: first.editInputs }, 'new', ['a', 'c'])
assert(again.leftover === 0, '이미 첨부한 사진은 leftover가 아니다')
assert(Object.keys(again.editInputs.new ?? {}).length === 3, '새 사진만 추가한다')

console.log('studio-library.verify ok')
