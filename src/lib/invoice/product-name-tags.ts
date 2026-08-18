import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type {
  InvoiceProductNameTagRole,
  InvoiceProductNameTagRoleEntry,
} from '@/lib/types'

export const RESERVATION_SHIPPING_DATE_FAMILY =
  'family:reservation_shipping_date'
export const RESERVATION_SHIPPING_DATE_LABEL = '[날짜 예약배송]'

export type ParsedProductNameTag = {
  raw: string
  normalized: string
  key: string
  role: InvoiceProductNameTagRole
  suggestedRole: InvoiceProductNameTagRole
}

export type FileTagGroup = {
  tag: ParsedProductNameTag
  productCount: number
  variantCount: number
  examples: string[]
}

/** 상품 구성이 아닌 선행 태그는 비교 키에서 뺀다. 미분류는 저장 전까지 원문을 유지한다. */
const STRIP_ROLES = new Set<InvoiceProductNameTagRole>([
  'event_marketing',
  'composition_gift',
  'identity_condition',
])

const DATE_THEN_RESERVATION =
  /^(?:\d{4}(?:[./-]|년\s*))?(?:\d{1,2}[./-]\d{1,2}|\d{1,2}\s*월\s*\d{1,2}\s*일)(?:\s*\([^)]+\))?\s*예약\s*배송$/

function isOpenBracket(value: string) {
  return value === '[' || value === '［'
}

function closeBracket(open: string) {
  return open === '［' ? '］' : ']'
}

function isSpace(value: string) {
  return value === ' ' || value === '\u00A0'
}

function tagInner(normalized: string) {
  return normalized.replace(/^\[|\]$/g, '').trim()
}

function reservationFamilyKey(normalized: string): string | null {
  const inner = tagInner(normalized)
  if (inner === '날짜 예약배송' || inner === '날짜예약배송') {
    return RESERVATION_SHIPPING_DATE_FAMILY
  }
  if (normalized === RESERVATION_SHIPPING_DATE_FAMILY) {
    return RESERVATION_SHIPPING_DATE_FAMILY
  }
  return DATE_THEN_RESERVATION.test(inner)
    ? RESERVATION_SHIPPING_DATE_FAMILY
    : null
}

/** 날짜만 다른 예약배송 태그는 같은 계열 키로 묶는다. */
export function tagRoleKey(tag: string): string {
  const normalized = normalizeInvoiceText(tag)
  return reservationFamilyKey(normalized) ?? normalized
}

export function isReservationShippingDateTag(tag: string): boolean {
  return tagRoleKey(tag) === RESERVATION_SHIPPING_DATE_FAMILY
}

function roleByKey(
  roles: InvoiceProductNameTagRoleEntry[],
): Map<string, InvoiceProductNameTagRole> {
  const byKey = new Map<string, InvoiceProductNameTagRole>()
  for (const role of roles) {
    if (!role.isActive) continue
    const key = tagRoleKey(role.normalizedTag) || tagRoleKey(role.tagText)
    if (!byKey.has(key) || role.normalizedTag === key) {
      byKey.set(key, role.role)
    }
  }
  return byKey
}

/** 품목명 맨 앞의 연속 [태그]만 추출한다. 원문과 태그 원문은 바꾸지 않는다. */
export function extractLeadingBracketTags(productName: string): {
  tags: string[]
  remainder: string
} {
  const source = productName
  const tags: string[] = []
  let index = 0
  while (index < source.length) {
    while (index < source.length && isSpace(source[index] ?? '')) index += 1
    const open = source[index] ?? ''
    if (!isOpenBracket(open)) break
    const close = closeBracket(open)
    const end = source.indexOf(close, index + 1)
    if (end < 0) break
    const raw = source.slice(index, end + 1)
    if (raw.length <= 2) break
    tags.push(raw)
    index = end + 1
  }
  return {
    tags,
    remainder: source.slice(index).trim(),
  }
}

/** UI 추천용. 저장 전에는 매칭에 쓰지 않는다. */
export function suggestTagRole(tag: string): InvoiceProductNameTagRole {
  const normalized = normalizeInvoiceText(tag)
  const inner = tagInner(normalized)
  if (/리퍼브|리퍼(?!브)|b급/.test(normalized)) return 'identity_condition'
  if (/증정/.test(normalized)) return 'composition_gift'
  if (
    /(?:^|[^가-힣])set(?:$|[^가-힣])/.test(inner) ||
    /세트|2pack|3pack|2팩|3팩/.test(inner) ||
    (/포함/.test(inner) && !/단독구성/.test(inner))
  ) {
    return 'product_composition'
  }
  if (
    isReservationShippingDateTag(normalized) ||
    /예약배송|1\+1|단독|기획|한정|이벤트/.test(normalized)
  ) {
    return 'event_marketing'
  }
  return 'unknown'
}

export function classifyLeadingTags(
  productName: string,
  roles: InvoiceProductNameTagRoleEntry[] = [],
): ParsedProductNameTag[] {
  const byKey = roleByKey(roles)
  return extractLeadingBracketTags(productName).tags.map((raw) => {
    const normalized = normalizeInvoiceText(raw)
    const key = tagRoleKey(raw)
    return {
      raw,
      normalized,
      key,
      role: byKey.get(key) ?? 'unknown',
      suggestedRole: suggestTagRole(raw),
    }
  })
}

/** 상품 구성·미분류만 남긴 인식용 품목명. 원문은 바꾸지 않는다. */
export function matchingProductName(
  productName: string,
  roles: InvoiceProductNameTagRoleEntry[] = [],
): string {
  const { remainder } = extractLeadingBracketTags(productName)
  const kept = classifyLeadingTags(productName, roles)
    .filter((tag) => !STRIP_ROLES.has(tag.role))
    .map((tag) => tag.raw)
    .join('')
  const next = `${kept}${kept && remainder ? ' ' : ''}${remainder}`.trim()
  return next || productName.trim()
}

export function countLeadingTagProducts(
  productNames: string[],
): Map<string, number> {
  const products = new Map<string, Set<string>>()
  for (const productName of productNames) {
    const productKey = normalizeInvoiceText(productName)
    if (!productKey) continue
    for (const tag of extractLeadingBracketTags(productName).tags) {
      const key = tagRoleKey(tag)
      const set = products.get(key) ?? new Set<string>()
      set.add(productKey)
      products.set(key, set)
    }
  }
  return new Map(
    [...products.entries()].map(([key, set]) => [key, set.size]),
  )
}

export function collectFileTagGroups(
  rows: { productName: string; tags: ParsedProductNameTag[] }[],
): FileTagGroup[] {
  const groups = new Map<
    string,
    {
      tag: ParsedProductNameTag
      products: Set<string>
      variants: Set<string>
      examples: string[]
    }
  >()
  for (const row of rows) {
    const productKey = normalizeInvoiceText(row.productName)
    if (!productKey) continue
    for (const tag of row.tags) {
      const current = groups.get(tag.key)
      if (!current) {
        groups.set(tag.key, {
          tag:
            tag.key === RESERVATION_SHIPPING_DATE_FAMILY
              ? {
                  ...tag,
                  raw: RESERVATION_SHIPPING_DATE_LABEL,
                  normalized: RESERVATION_SHIPPING_DATE_FAMILY,
                }
              : tag,
          products: new Set([productKey]),
          variants: new Set([tag.normalized]),
          examples:
            tag.key === RESERVATION_SHIPPING_DATE_FAMILY ? [tag.raw] : [],
        })
        continue
      }
      current.products.add(productKey)
      current.variants.add(tag.normalized)
      if (
        tag.key === RESERVATION_SHIPPING_DATE_FAMILY &&
        current.examples.length < 3 &&
        !current.examples.includes(tag.raw)
      ) {
        current.examples.push(tag.raw)
      }
    }
  }
  return [...groups.values()]
    .map((group) => ({
      tag: group.tag,
      productCount: group.products.size,
      variantCount: group.variants.size,
      examples: group.examples,
    }))
    .sort((left, right) => {
      const leftUnknown = left.tag.role === 'unknown' ? 0 : 1
      const rightUnknown = right.tag.role === 'unknown' ? 0 : 1
      if (leftUnknown !== rightUnknown) return leftUnknown - rightUnknown
      if (right.productCount !== left.productCount) {
        return right.productCount - left.productCount
      }
      return left.tag.raw.localeCompare(right.tag.raw, 'ko-KR')
    })
}

export function tagRoleFingerprint(
  roles: InvoiceProductNameTagRoleEntry[],
): string {
  const byKey = new Map<string, InvoiceProductNameTagRole>()
  for (const role of roles) {
    if (!role.isActive) continue
    const key = tagRoleKey(role.normalizedTag) || tagRoleKey(role.tagText)
    if (!byKey.has(key) || role.normalizedTag === key) {
      byKey.set(key, role.role)
    }
  }
  return [...byKey.entries()]
    .map(([key, role]) => `${key}:${role}`)
    .sort()
    .join('|')
}
