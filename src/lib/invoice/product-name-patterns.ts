import {
  matchingItemName,
  matchingProductName,
} from '@/lib/invoice/product-name-tags'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type {
  InvoiceProductNameMap,
  InvoiceProductNameTagRoleEntry,
} from '@/lib/types'

export type ProductNameCandidate = {
  text: string
  rule: string
  reason: string
}

export type ProductNameRegistrationRule =
  | 'product'
  | 'item_full'
  | 'product_item'

const EMPTY_HINTS = new Set([
  '',
  '-',
  '선택안함',
  'free',
  'one color',
  'onecolor',
  'one-color',
])

export function isEmptyItemNameHint(value: string) {
  return EMPTY_HINTS.has(normalizeInvoiceText(value).replace(/\s+/g, ''))
}

/** 시트 TRIM과 같게 앞뒤 공백을 없애고 연속 공백을 한 칸으로 줄인다. */
function sheetTrim(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function pushCandidate(
  output: ProductNameCandidate[],
  seen: Set<string>,
  text: string,
  rule: string,
  reason: string,
) {
  const trimmed = sheetTrim(text)
  if (!trimmed) return
  const key = normalizeInvoiceText(trimmed)
  if (!key || seen.has(key)) return
  seen.add(key)
  output.push({ text: trimmed, rule, reason })
}

/** `REGEXEXTRACT(value, "^(.*?)X")`와 같다. 첫 구분자 앞부분만 돌려준다. */
function prefixBefore(value: string, delimiter: string): string | null {
  const at = value.indexOf(delimiter)
  if (at < 0) return null
  return value.slice(0, at)
}

function suffixAfter(value: string, delimiter: string): string {
  const at = value.indexOf(delimiter)
  if (at < 0) return ''
  return value.slice(at + delimiter.length)
}

function itemPrefixParts(
  itemName: string,
  delimiter: string,
): { prefix: string; suffix: string } | null {
  const prefix = prefixBefore(itemName, delimiter)
  if (prefix === null) return null
  const trimmedPrefix = sheetTrim(prefix)
  const suffix = sheetTrim(suffixAfter(itemName, delimiter))
  if (!trimmedPrefix || !suffix) return null
  return { prefix: trimmedPrefix, suffix }
}

/** `REGEXEXTRACT(value, "^(Color:\\s*[^:]+)")`와 같다. Color: 라벨을 키에 남긴다. */
function colorLabelPrefix(value: string): string | null {
  const match = /^(Color:\s*[^:]+)/.exec(value)
  return match ? (match[1] ?? null) : null
}

/**
 * 원장 자동 확정 후보. 반환 순서가 우선순위다.
 * 구분자 뒷부분 단독과 옵션값 단독은 오탐이 커서 만들지 않는다.
 */
function generateCandidatesForProductName(
  productName: string,
  itemName: string,
  output: ProductNameCandidate[],
  seen: Set<string>,
) {
  pushCandidate(output, seen, productName, 'product', '품목명 단독')

  if (itemName && !isEmptyItemNameHint(itemName)) {
    pushCandidate(
      output,
      seen,
      `${productName} ${itemName}`,
      'product_item',
      '품목명 한 칸 띄고 내품명 전체',
    )
  }

  const slashParts = itemPrefixParts(itemName, '/')
  const commaParts = itemPrefixParts(itemName, ',')
  const slashPrefix = prefixBefore(itemName, '/')
  const commaPrefix = prefixBefore(itemName, ',')
  const colorPrefix = colorLabelPrefix(itemName)
  const colonPrefix = prefixBefore(itemName, ':')
  const combinedColumns: [string, string | null, string][] = [
    ['product_item_slash_prefix', slashPrefix, '품목명 + 내품명 첫 / 앞부분'],
    ['product_item_comma_prefix', commaPrefix, '품목명 + 내품명 첫 , 앞부분'],
    ['product_item_color_label', colorPrefix, '품목명 + 내품명 Color: 라벨 구간'],
    ['product_item_colon_prefix', colonPrefix, '품목명 + 내품명 첫 : 앞부분'],
  ]
  for (const [rule, extracted, reason] of combinedColumns) {
    if (extracted === null) continue
    pushCandidate(
      output,
      seen,
      `${productName} ${sheetTrim(extracted)}`,
      rule,
      reason,
    )
  }

  if (slashParts) {
    pushCandidate(
      output,
      seen,
      slashParts.prefix,
      'item_slash_prefix',
      '내품명 첫 / 앞부분만 사용',
    )
  }
  if (commaParts) {
    pushCandidate(
      output,
      seen,
      commaParts.prefix,
      'item_comma_prefix',
      '내품명 첫 , 앞부분만 사용',
    )
  }

  if (itemName && !isEmptyItemNameHint(itemName)) {
    pushCandidate(
      output,
      seen,
      itemName,
      'item_full',
      '품목명을 보지 않고 내품명 전체만 사용',
    )
  }
}

/** 같은 rule의 태그 전·후 후보를 구분하는 React key·선택 식별자. */
export function productNameCandidateKey(candidate: ProductNameCandidate): string {
  return `${candidate.rule}:${normalizeInvoiceText(candidate.text)}`
}

export function pickDefaultProductNameLookupKey(combo: {
  candidates: ProductNameCandidate[]
  appliedRule: string | null
  appliedLookupKey?: string | null
}): string {
  if (combo.candidates.length === 0) return ''
  if (combo.appliedLookupKey) {
    const exact = combo.candidates.find(
      (candidate) => candidate.text === combo.appliedLookupKey,
    )
    if (exact) return exact.text
  }
  if (combo.appliedRule) {
    const byRule = combo.candidates.find(
      (candidate) => candidate.rule === combo.appliedRule,
    )
    if (byRule) return byRule.text
  }
  return combo.candidates[0]!.text
}

export function generateProductNameCandidates(input: {
  productName: string
  itemName: string
  mallName?: string
  matchingProductName?: string
  matchingItemName?: string
}): ProductNameCandidate[] {
  const productName = input.productName.trim()
  const itemName = input.itemName.trim()
  const matching = (input.matchingProductName ?? productName).trim()
  const matchingItem = (input.matchingItemName ?? itemName).trim()
  const output: ProductNameCandidate[] = []
  const seen = new Set<string>()
  generateCandidatesForProductName(productName, itemName, output, seen)
  if (normalizeInvoiceText(matching) !== normalizeInvoiceText(productName)) {
    generateCandidatesForProductName(matching, itemName, output, seen)
  }
  if (normalizeInvoiceText(matchingItem) !== normalizeInvoiceText(itemName)) {
    generateCandidatesForProductName(productName, matchingItem, output, seen)
    if (normalizeInvoiceText(matching) !== normalizeInvoiceText(productName)) {
      generateCandidatesForProductName(matching, matchingItem, output, seen)
    }
  }
  return output
}

/**
 * 신규 원장 등록 전용 후보.
 * 자동 조회용 앞부분 후보와 분리하고 품목명·내품명·두 열 전체 조합만 만든다.
 */
export function generateProductNameRegistrationCandidates(input: {
  productName: string
  itemName: string
}): ProductNameCandidate[] {
  const productName = sheetTrim(input.productName)
  const itemName = sheetTrim(input.itemName)
  const output: ProductNameCandidate[] = []
  const seen = new Set<string>()

  pushCandidate(output, seen, productName, 'product', '품목명')
  if (itemName && !isEmptyItemNameHint(itemName)) {
    pushCandidate(output, seen, itemName, 'item_full', '내품명')
    pushCandidate(
      output,
      seen,
      `${productName} ${itemName}`,
      'product_item',
      '품목명 + 내품명',
    )
  }
  return output
}

/** 기존 자동 조회 규칙을 가장 가까운 신규 등록 3종으로 접는다. */
export function productNameRegistrationRuleForMatch(
  rule: string | null,
): ProductNameRegistrationRule {
  if (rule?.startsWith('item_')) return 'item_full'
  if (rule?.startsWith('product_item')) return 'product_item'
  return 'product'
}

export function pickProductNameRegistrationCandidate(
  candidates: ProductNameCandidate[],
  matchedRule: string | null,
): ProductNameCandidate | null {
  if (candidates.length === 0) return null
  const preferredRule = productNameRegistrationRuleForMatch(matchedRule)
  return (
    candidates.find((candidate) => candidate.rule === preferredRule) ??
    candidates[0]!
  )
}

export type ItemNameConsumptionKind = 'none' | 'full' | 'prefix'

export type ItemNameConsumption = {
  kind: ItemNameConsumptionKind
  effectiveItemName: string
}

export function resolveItemNameConsumption(
  rule: string | null,
  itemName: string,
): ItemNameConsumption {
  if (rule === 'item_full') {
    return { kind: 'full', effectiveItemName: '' }
  }
  if (rule === 'item_slash_prefix') {
    const parts = itemPrefixParts(itemName, '/')
    if (parts) return { kind: 'prefix', effectiveItemName: parts.suffix }
  }
  if (rule === 'item_comma_prefix') {
    const parts = itemPrefixParts(itemName, ',')
    if (parts) return { kind: 'prefix', effectiveItemName: parts.suffix }
  }
  return { kind: 'none', effectiveItemName: itemName }
}

export function productNameRuleConsumesItemName(rule: string | null) {
  return rule === 'item_full'
}

export function productNameRuleStripsItemPrefix(rule: string | null) {
  return rule === 'item_slash_prefix' || rule === 'item_comma_prefix'
}

const SIMILAR_PRODUCT_DELIMITERS = ['_', '/', ',', ':', '|'] as const

/**
 * 비슷한 상품 조회용. 색상·옵션 구분자 앞의 상품명 앞부분만 남긴다.
 * 앞부분이 두 글자 미만이면 원본을 그대로 돌려준다.
 */
export function similarProductSearchText(lookupKey: string): string {
  const trimmed = sheetTrim(lookupKey)
  if (!trimmed) return ''
  let earliest = -1
  for (const delimiter of SIMILAR_PRODUCT_DELIMITERS) {
    const at = trimmed.indexOf(delimiter)
    if (at < 0) continue
    if (earliest < 0 || at < earliest) earliest = at
  }
  if (earliest < 0) return trimmed
  const prefix = sheetTrim(trimmed.slice(0, earliest))
  return prefix.length >= 2 ? prefix : trimmed
}

/** 품목명 원장 등록 시 내품명 기준에 쓸 값. 앞부분 단독이면 남은 suffix다. */
export function optionMapItemNameForRule(rule: string | null, itemName: string) {
  const consumption = resolveItemNameConsumption(rule, itemName)
  return consumption.kind === 'prefix' ? consumption.effectiveItemName : itemName
}

export function collectProductNameCandidateTexts(
  rows: {
    productName: string
    itemName: string
    mallName?: string
  }[],
  tagRoles: InvoiceProductNameTagRoleEntry[] = [],
): string[] {
  const seen = new Set<string>()
  const texts: string[] = []
  for (const row of rows) {
    for (const candidate of generateProductNameCandidates({
      ...row,
      matchingProductName: matchingProductName(row.productName, tagRoles),
      matchingItemName: matchingItemName(row.itemName, tagRoles),
    })) {
      const key = normalizeInvoiceText(candidate.text)
      if (seen.has(key)) continue
      seen.add(key)
      texts.push(candidate.text)
    }
  }
  return texts
}

export function invoiceLookupTextsSig(texts: string[]): string {
  const unique = [
    ...new Set(texts.map((text) => normalizeInvoiceText(text)).filter(Boolean)),
  ].sort()
  let hash = 2166136261
  for (const key of unique) {
    for (let i = 0; i < key.length; i += 1) {
      hash ^= key.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    hash ^= 10
    hash = Math.imul(hash, 16777619)
  }
  return `${unique.length}:${(hash >>> 0).toString(16)}`
}

export function filterProductNameMapsForLookupTexts(
  maps: InvoiceProductNameMap[],
  texts: string[],
): InvoiceProductNameMap[] {
  const keys = new Set(
    texts.map((text) => normalizeInvoiceText(text)).filter(Boolean),
  )
  if (keys.size === 0) return []
  return maps.filter((map) => keys.has(map.normalizedLookupKey))
}
