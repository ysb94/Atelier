/**
 * 부서 상품 작업 목록 파싱 검증.
 * 실행: npx vite-node src/lib/products/department-work-set.verify.ts
 */
import {
  findStylesByStyleNos,
  mergeStyleIds,
  parseStyleNoList,
} from './department-work-set'
import type { Style } from '@/lib/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(
  parseStyleNoList('a-1\nb-2, c-3').join('|') === 'A-1|B-2|C-3',
  '붙여넣은 품번은 한 형태로 맞춘다',
)
assert(
  parseStyleNoList('A-1\nA-1').length === 1,
  '같은 품번은 한 번만 남긴다',
)

const styles = [
  { id: 's1', styleNo: 'A-1' },
  { id: 's2', styleNo: 'B 2' },
] as Style[]

const found = findStylesByStyleNos(styles, ['a-1', 'missing', 'b-2'])
assert(found.matched.map((style) => style.id).join('|') === 's1|s2', '있는 품번만 고른다')
assert(found.missing.join('|') === 'missing', '없는 품번은 남긴다')

assert(
  mergeStyleIds(['s1'], ['s1', 's2']).join('|') === 's1|s2',
  '이미 있는 상품은 다시 넣지 않는다',
)

console.log('department-work-set: 모든 검증을 통과했습니다.')
