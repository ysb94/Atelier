/**
 * 품목명 선행 [태그] 추출·역할·매칭명 검증.
 * 실행: npm run verify:product-name-tags
 */
import { generateProductNameCandidates } from '@/lib/invoice/product-name-patterns'
import { compactProductNameKey } from '@/lib/invoice/lookup-normalization'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import {
  RESERVATION_SHIPPING_DATE_FAMILY,
  classifyLeadingTags,
  collectFileTagGroups,
  extractLeadingBracketTags,
  matchingProductName,
  suggestTagRole,
  tagRoleKey,
} from '@/lib/invoice/product-name-tags'
import type {
  InvoiceProductNameTagRole,
  InvoiceProductNameTagRoleEntry,
} from '@/lib/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function role(
  tagText: string,
  value: InvoiceProductNameTagRole,
): InvoiceProductNameTagRoleEntry {
  return {
    id: tagText,
    brandId: 'brand',
    tagText,
    normalizedTag: normalizeInvoiceText(tagText),
    role: value,
    isActive: true,
    note: '',
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
  }
}

const consecutive = extractLeadingBracketTags(
  '[단독][태슬1개 포함] 마스마룰즈 베이직 파우치',
)
assert(consecutive.tags.join(',') === '[단독],[태슬1개 포함]', '연속 태그')
assert(consecutive.remainder === '마스마룰즈 베이직 파우치', '연속 태그 뒤 원문')

const fullwidth = extractLeadingBracketTags(
  '［8/14예약배송］［에어팟파우치세트］Travel sacoche bag',
)
assert(fullwidth.tags.length === 2, '전각 괄호도 맨 앞 태그')
assert(fullwidth.remainder === 'Travel sacoche bag', '전각 태그 뒤 상품명')

const middle = extractLeadingBracketTags('Travel sacoche [black] bag')
assert(middle.tags.length === 0, '중간 대괄호는 태그로 보지 않음')
assert(middle.remainder === 'Travel sacoche [black] bag', '중간 대괄호 원문 유지')

assert(
  tagRoleKey('[8/21예약배송]') === RESERVATION_SHIPPING_DATE_FAMILY,
  '슬래시 날짜 예약배송은 계열',
)
assert(
  tagRoleKey('[8/21 예약배송]') === RESERVATION_SHIPPING_DATE_FAMILY,
  '공백 있는 날짜 예약배송은 계열',
)
assert(
  tagRoleKey('[8월 21일 예약배송]') === RESERVATION_SHIPPING_DATE_FAMILY,
  '한글 날짜 예약배송은 계열',
)
assert(tagRoleKey('[단독]') === normalizeInvoiceText('[단독]'), '단독은 exact')
assert(suggestTagRole('[8/21예약배송]') === 'event_marketing', '예약배송 추천')
assert(suggestTagRole('[1+1]') === 'event_marketing', '1+1 추천')
assert(suggestTagRole('[비치볼 증정]') === 'composition_gift', '증정 추천')
assert(suggestTagRole('[태슬1개 포함]') === 'composition_gift', '포함 추천')
assert(suggestTagRole('[리퍼브]') === 'identity_condition', '리퍼브 추천')
assert(suggestTagRole('[생일/응원/축하]') === 'unknown', '불확실 태그는 미분류')

const unsavedReservation = classifyLeadingTags(
  '[8/21예약배송] 마스마룰즈 로그 나일론 숄더백',
)
assert(unsavedReservation[0]?.role === 'unknown', '저장 전 예약배송은 미분류')
assert(
  unsavedReservation[0]?.raw === '[8/21예약배송]',
  '예약배송 원문 태그는 유지',
)
assert(
  classifyLeadingTags('[8/19예약배송] 파우치', [
    role('[8/14예약배송]', 'event_marketing'),
  ])[0]?.role === 'event_marketing',
  '기존 날짜 저장값을 다른 날짜에 재사용',
)
assert(
  matchingProductName('[8/21예약배송] 베이직 파우치', [
    role('[8/14예약배송]', 'event_marketing'),
  ]) === '베이직 파우치',
  '예약배송 계열을 빼도 원문 태그는 별도 유지',
)
const unsaved = classifyLeadingTags('[단독] 마스마룰즈 로그 나일론 숄더백')
assert(unsaved[0]?.role === 'unknown', '저장 전 역할은 미분류')
assert(
  matchingProductName('[단독] 마스마룰즈 로그 나일론 숄더백') ===
    '[단독] 마스마룰즈 로그 나일론 숄더백',
  '미분류는 매칭명에서 빼지 않음',
)

const mixed = matchingProductName(
  '[단독][태슬1개 포함][리퍼브] 베이직 파우치',
  [
    role('[단독]', 'event_marketing'),
    role('[태슬1개 포함]', 'composition_gift'),
    role('[리퍼브]', 'identity_condition'),
  ],
)
assert(mixed === '[리퍼브] 베이직 파우치', '행사·구성만 제외하고 특징은 유지')

const original = generateProductNameCandidates({
  productName: '[단독] 마스마룰즈 래빗에코백 32타입',
  itemName: 'Color: 트로피칼',
})
const stripped = generateProductNameCandidates({
  productName: '[단독] 마스마룰즈 래빗에코백 32타입',
  itemName: 'Color: 트로피칼',
  matchingProductName: '마스마룰즈 래빗에코백 32타입',
})
assert(
  original[0]?.text === '[단독] 마스마룰즈 래빗에코백 32타입 Color: 트로피칼',
  '원문 후보가 먼저',
)
assert(
  stripped.some(
    (item) => item.text === '마스마룰즈 래빗에코백 32타입 Color: 트로피칼',
  ),
  '역할 반영 후보를 뒤에 추가',
)
assert(
  stripped.findIndex(
    (item) => item.text === '[단독] 마스마룰즈 래빗에코백 32타입 Color: 트로피칼',
  ) <
    stripped.findIndex(
      (item) => item.text === '마스마룰즈 래빗에코백 32타입 Color: 트로피칼',
    ),
  '원문 후보가 역할 반영 후보보다 앞',
)

const fileGroups = collectFileTagGroups([
  {
    productName: '[8/21예약배송] 파우치',
    tags: classifyLeadingTags('[8/21예약배송] 파우치'),
  },
  {
    productName: '[8/19예약배송] 에코백',
    tags: classifyLeadingTags('[8/19예약배송] 에코백'),
  },
  {
    productName: '[단독] 에코백',
    tags: classifyLeadingTags('[단독] 에코백'),
  },
])
assert(
  fileGroups.filter((group) => group.tag.key === RESERVATION_SHIPPING_DATE_FAMILY)
    .length === 1,
  '날짜 예약배송은 파일 태그 한 칸',
)
assert(
  fileGroups.find((group) => group.tag.key === RESERVATION_SHIPPING_DATE_FAMILY)
    ?.variantCount === 2,
  '날짜 변형 수를 모은다',
)

assert(
  compactProductNameKey('MSMRZ Logo Ball cap_12color / Color: Ivory') ===
    compactProductNameKey('msmrz logo ball cap 12color Color=Ivory'),
  '대소문자·공백·기호 차이는 압축 키가 같음',
)
assert(
  compactProductNameKey('[1+1] MSMRZ Logo Ball cap') !==
    compactProductNameKey('MSMRZ Logo Ball cap'),
  '압축 키는 태그 괄호를 직접 해석하지 않음',
)
assert(
  compactProductNameKey('[리퍼브] String flap backpack') ===
    '리퍼브stringflapbackpack',
  '특징 태그는 압축 키에 내용이 남음',
)

console.log('product-name-tags verify: ok')
