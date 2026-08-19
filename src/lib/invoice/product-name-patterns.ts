import { matchingProductName } from '@/lib/invoice/product-name-tags'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type { InvoiceProductNameTagRoleEntry } from '@/lib/types'

export type ProductNameCandidate = {
  text: string
  rule: string
  reason: string
}

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

export function generateProductNameCandidates(input: {
  productName: string
  itemName: string
  mallName?: string
  matchingProductName?: string
}): ProductNameCandidate[] {
  const productName = input.productName.trim()
  const itemName = input.itemName.trim()
  const matching = (input.matchingProductName ?? productName).trim()
  const output: ProductNameCandidate[] = []
  const seen = new Set<string>()
  generateCandidatesForProductName(productName, itemName, output, seen)
  if (normalizeInvoiceText(matching) !== normalizeInvoiceText(productName)) {
    generateCandidatesForProductName(matching, itemName, output, seen)
  }
  return output
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
    })) {
      const key = normalizeInvoiceText(candidate.text)
      if (seen.has(key)) continue
      seen.add(key)
      texts.push(candidate.text)
    }
  }
  return texts
}
