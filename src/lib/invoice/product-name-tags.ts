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

export type FileOptionReservationTagGroup = {
  tag: ParsedProductNameTag
  itemCount: number
  variantCount: number
  examples: string[]
  previews: Array<{ raw: string; matching: string }>
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
  if (/증정|사은품/.test(normalized)) return 'composition_gift'
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

function classifyReservationToken(
  raw: string,
  byKey: Map<string, InvoiceProductNameTagRole>,
): ParsedProductNameTag {
  const normalized = normalizeInvoiceText(raw)
  const key = tagRoleKey(raw)
  return {
    raw,
    normalized,
    key,
    role: byKey.get(key) ?? 'unknown',
    suggestedRole: suggestTagRole(raw),
  }
}

/** 옵션 문자열 어디에 있든 날짜 예약배송 대괄호만 추출한다. 다른 대괄호는 보지 않는다. */
export function extractInlineReservationShippingDateTags(value: string): string[] {
  const tags: string[] = []
  let index = 0
  while (index < value.length) {
    const open = value[index] ?? ''
    if (!isOpenBracket(open)) {
      index += 1
      continue
    }
    const close = closeBracket(open)
    const end = value.indexOf(close, index + 1)
    if (end < 0) break
    const raw = value.slice(index, end + 1)
    if (raw.length > 2 && isReservationShippingDateTag(raw)) tags.push(raw)
    index = end + 1
  }
  return tags
}

export function classifyInlineReservationShippingDateTags(
  itemName: string,
  roles: InvoiceProductNameTagRoleEntry[] = [],
): ParsedProductNameTag[] {
  const byKey = roleByKey(roles)
  return extractInlineReservationShippingDateTags(itemName).map((raw) =>
    classifyReservationToken(raw, byKey),
  )
}

function replaceInlineReservationShippingDateTags(
  value: string,
  shouldStrip: (raw: string) => boolean,
): string {
  let result = ''
  let index = 0
  while (index < value.length) {
    const open = value[index] ?? ''
    if (!isOpenBracket(open)) {
      result += open
      index += 1
      continue
    }
    const close = closeBracket(open)
    const end = value.indexOf(close, index + 1)
    if (end < 0) {
      result += value.slice(index)
      break
    }
    const raw = value.slice(index, end + 1)
    result +=
      raw.length > 2 &&
      isReservationShippingDateTag(raw) &&
      shouldStrip(raw)
        ? ' '
        : raw
    index = end + 1
  }
  return result.replace(/\s+/g, ' ').trim()
}

/** 저장된 비교 제외 역할의 날짜 예약배송 토큰만 뺀 옵션 비교값. */
export function matchingItemNameFromTags(
  itemName: string,
  classifiedTags: ParsedProductNameTag[],
): string {
  const roleByRaw = new Map(
    classifiedTags.map((tag) => [tag.raw, tag.role] as const),
  )
  const next = replaceInlineReservationShippingDateTags(itemName, (raw) =>
    STRIP_ROLES.has(roleByRaw.get(raw) ?? 'unknown'),
  )
  return next || itemName.trim()
}

/** 저장된 예약배송 역할이 비교 제외일 때만 옵션 비교값을 정리한다. */
export function matchingItemName(
  itemName: string,
  roles: InvoiceProductNameTagRoleEntry[] = [],
): string {
  return matchingItemNameFromTags(
    itemName,
    classifyInlineReservationShippingDateTags(itemName, roles),
  )
}

/** 이미 분류한 파일 태그에서 상품 구성·미분류만 남긴 품목명. */
export function matchingProductNameFromTags(
  productName: string,
  classifiedTags: ParsedProductNameTag[],
): string {
  const { tags, remainder } = extractLeadingBracketTags(productName)
  const roleByRaw = new Map(
    classifiedTags.map((tag) => [tag.raw, tag.role] as const),
  )
  const kept = tags
    .filter((raw) => !STRIP_ROLES.has(roleByRaw.get(raw) ?? 'unknown'))
    .join('')
  const next = `${kept}${kept && remainder ? ' ' : ''}${remainder}`.trim()
  return next || productName.trim()
}

/** 상품 구성·미분류만 남긴 인식용 품목명. 원문은 바꾸지 않는다. */
export function matchingProductName(
  productName: string,
  roles: InvoiceProductNameTagRoleEntry[] = [],
): string {
  return matchingProductNameFromTags(
    productName,
    classifyLeadingTags(productName, roles),
  )
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

export function collectFileOptionReservationTagGroups(
  rows: { itemName: string; itemTags: ParsedProductNameTag[] }[],
): FileOptionReservationTagGroup[] {
  const groups = new Map<
    string,
    {
      tag: ParsedProductNameTag
      items: Set<string>
      variants: Set<string>
      examples: string[]
      previews: Array<{ raw: string; matching: string }>
    }
  >()
  for (const row of rows) {
    const itemKey = normalizeInvoiceText(row.itemName)
    if (!itemKey || row.itemTags.length === 0) continue
    const matching = matchingItemNameFromTags(row.itemName, row.itemTags)
    for (const tag of row.itemTags) {
      if (tag.key !== RESERVATION_SHIPPING_DATE_FAMILY) continue
      const current = groups.get(tag.key)
      if (!current) {
        groups.set(tag.key, {
          tag: {
            ...tag,
            raw: RESERVATION_SHIPPING_DATE_LABEL,
            normalized: RESERVATION_SHIPPING_DATE_FAMILY,
          },
          items: new Set([itemKey]),
          variants: new Set([tag.normalized]),
          examples: [tag.raw],
          previews: [{ raw: row.itemName, matching }],
        })
        continue
      }
      current.items.add(itemKey)
      current.variants.add(tag.normalized)
      if (current.examples.length < 3 && !current.examples.includes(tag.raw)) {
        current.examples.push(tag.raw)
      }
      if (
        current.previews.length < 2 &&
        !current.previews.some((preview) => preview.raw === row.itemName)
      ) {
        current.previews.push({ raw: row.itemName, matching })
      }
    }
  }
  return [...groups.values()]
    .map((group) => ({
      tag: group.tag,
      itemCount: group.items.size,
      variantCount: group.variants.size,
      examples: group.examples,
      previews: group.previews,
    }))
    .sort((left, right) => {
      const leftUnknown = left.tag.role === 'unknown' ? 0 : 1
      const rightUnknown = right.tag.role === 'unknown' ? 0 : 1
      if (leftUnknown !== rightUnknown) return leftUnknown - rightUnknown
      if (right.itemCount !== left.itemCount) {
        return right.itemCount - left.itemCount
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
