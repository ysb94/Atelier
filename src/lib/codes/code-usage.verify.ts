/**
 * 업체별 88코드 연결의 변경 계획·건수·검색 문자열 검증.
 * 실행: npm run verify:code-usage
 */
import type {
  CodeUsageAssignment,
  CodeUsageAssignmentChange,
  ProductCode,
} from '@/lib/types'
import {
  CODE_FINDER_PAGE_SIZE,
  EMPTY_ASSIGNMENT_COUNTS,
  codeComponentSummary,
  codeSearchText,
  compactCodeUsageChanges,
  countAssignmentsByTarget,
  mergeCodeUsageAssignments,
  planCodeUsageChanges,
} from './code-usage'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function change(
  productCodeId: string,
  usageTargetId: string,
  status: CodeUsageAssignmentChange['status'],
): CodeUsageAssignmentChange {
  return { productCodeId, usageTargetId, status }
}

function assignment(
  productCodeId: string,
  usageTargetId: string,
  status: CodeUsageAssignment['status'],
  updatedAt = '2026-01-01T00:00:00.000Z',
): CodeUsageAssignment {
  return {
    id: `${productCodeId}:${usageTargetId}`,
    brandId: 'brand',
    productCodeId,
    usageTargetId,
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  }
}

const existing = [
  assignment('code-a', 'target-1', 'active'),
  assignment('code-b', 'target-1', 'paused'),
]

const sameStatus = planCodeUsageChanges(existing, [
  change('code-a', 'target-1', 'active'),
])
assert(
  sameStatus.created === 0 &&
    sameStatus.updated === 0 &&
    sameStatus.skipped === 1 &&
    sameStatus.changes.length === 0,
  '같은 상태는 저장하지 않아야 한다',
)

const mixed = planCodeUsageChanges(existing, [
  change('code-a', 'target-1', 'paused'),
  change('code-c', 'target-1', 'active'),
  change('code-b', 'target-2', 'paused'),
  change('  ', 'target-1', 'active'),
  change('code-c', 'target-1', 'paused'),
])
assert(mixed.created === 2, '없는 연결은 만들어야 한다')
assert(mixed.updated === 1, '다른 상태는 바꿔야 한다')
assert(mixed.skipped === 0, '빈 키와 덮어쓴 중복은 건너뛰기에 넣지 않는다')
assert(
  mixed.changes.find(
    (row) => row.productCodeId === 'code-c' && row.usageTargetId === 'target-1',
  )?.status === 'paused',
  '같은 키는 마지막 상태만 남겨야 한다',
)
assert(
  mixed.changes.every((row) => row.productCodeId.trim() && row.usageTargetId.trim()),
  '빈 키는 계획에 남으면 안 된다',
)

const compacted = compactCodeUsageChanges([
  change(' code-a ', ' target-1 ', 'active'),
  change('code-a', 'target-1', 'paused'),
])
assert(
  compacted.length === 1 && compacted[0]?.status === 'paused',
  '압축할 때도 마지막 상태가 이겨야 한다',
)

const counts = countAssignmentsByTarget([
  ...existing,
  assignment('code-c', 'target-1', 'active'),
  assignment('code-a', 'target-2', 'paused'),
])
assert(counts.get('target-1')?.total === 3, '업체별 전체 건수를 세야 한다')
assert(counts.get('target-1')?.active === 2, '사용중 건수를 세야 한다')
assert(counts.get('target-1')?.paused === 1, '일시중지 건수를 세야 한다')
assert(counts.get('target-2')?.paused === 1, '다른 업체와 섞이면 안 된다')
assert(
  (counts.get('missing') ?? EMPTY_ASSIGNMENT_COUNTS).total === 0,
  '연결이 없는 업체는 0건이어야 한다',
)

const styleNames = new Map([
  ['style-1', '볼 캡 그레이'],
  ['style-2', '스파 포일레더 멜론'],
])
const code = {
  code: '8809702657381',
  name: 'MSMRZ Logo Ball cap - Gray',
  components: [
    { styleId: 'style-1', styleNo: 'M0191', qty: 1 },
    { styleId: 'style-2', styleNo: 'M0600', qty: 2 },
  ],
} satisfies Pick<ProductCode, 'code' | 'name' | 'components'>

const searchText = codeSearchText(code, styleNames)
assert(searchText.includes('8809702657381'), '바코드를 검색 문자열에 넣어야 한다')
assert(searchText.includes('ball cap'), '코드명을 소문자로 넣어야 한다')
assert(searchText.includes('m0191'), 'M번호를 소문자로 넣어야 한다')
assert(searchText.includes('볼 캡 그레이'), '상품명을 검색 문자열에 넣어야 한다')
assert(
  codeSearchText(
    { code: '1', name: '이름', components: [] },
    styleNames,
  ) === '1\n이름',
  '구성이 없어도 바코드와 코드명은 남아야 한다',
)
assert(
  codeComponentSummary(code, styleNames) ===
    '볼 캡 그레이 · M0191, 스파 포일레더 멜론 · M0600×2',
  '둘째 줄은 상품명과 M번호, 수량이다',
)
assert(
  codeComponentSummary(
    { components: [{ styleId: 'missing', styleNo: 'M0001', qty: 1 }] },
    styleNames,
  ) === 'M0001',
  '상품명이 없으면 M번호만 보여야 한다',
)
assert(
  codeComponentSummary({ components: [] }, styleNames) === 'M번호 없음',
  '구성이 없으면 M번호 없음을 보여야 한다',
)

const merged = mergeCodeUsageAssignments(
  [
    assignment('code-a', 'target-1', 'active', '2026-01-02T00:00:00.000Z'),
    assignment('code-b', 'target-1', 'paused', '2026-01-01T00:00:00.000Z'),
  ],
  [
    assignment('code-a', 'target-1', 'paused', '2026-01-03T00:00:00.000Z'),
    assignment('code-c', 'target-1', 'active', '2026-01-02T00:00:00.000Z'),
  ],
)
assert(merged.length === 3, '새 연결과 기존 연결을 함께 둬야 한다')
assert(
  merged[0]?.productCodeId === 'code-a' && merged[0].status === 'paused',
  '같은 키는 저장된 행으로 바꿔야 한다',
)
assert(
  merged.map((row) => row.productCodeId).join(',') === 'code-a,code-c,code-b',
  '최근 수정이 위로 와야 한다',
)
assert(
  mergeCodeUsageAssignments(existing, []).length === existing.length,
  '저장 결과가 없으면 기존 목록을 유지해야 한다',
)
assert(CODE_FINDER_PAGE_SIZE === 100, '코드 찾기는 100건씩 보여야 한다')

console.log('code-usage.verify ok')
