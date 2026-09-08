/**
 * 회사 목록 복합 행 키 검증.
 * 실행: npx tsx src/lib/workspace/company-row-key.verify.ts
 */
import {
  companyRowKey,
  parseCompanyRowKey,
  sameBrandId,
} from './company-row-key'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(
  companyRowKey('brand-a', 'row-1') === 'brand-a:row-1',
  '행 키는 brandId + row.id',
)

const parsed = parseCompanyRowKey('brand-a:row-1')
assert(parsed?.brandId === 'brand-a' && parsed.rowId === 'row-1', '행 키 파싱')

assert(parseCompanyRowKey('nocolon') == null, '구분자 없으면 무효')
assert(parseCompanyRowKey(':only') == null, '브랜드 없는 키는 무효')
assert(
  parseCompanyRowKey('brand-a:row:extra')?.rowId === 'row:extra',
  '행 id에 콜론이 있어도 앞 브랜드만 자른다',
)

assert(sameBrandId('a', 'a'), '같은 브랜드')
assert(!sameBrandId('a', 'b'), '다른 브랜드')
assert(!sameBrandId(null, 'a'), '빈 브랜드는 같지 않음')

console.log('company-row-key.verify ok')
