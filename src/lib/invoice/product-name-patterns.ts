import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'

export type ProductNameCandidate = {
  text: string
  rule: string
  reason: string
}

const ITEM_ONLY_PRODUCT_RULES = new Set([
  'item_slash_prefix',
  'item_comma_prefix',
  'item_full',
  'item_value',
  'item_slash_suffix',
])

/**
 * 품목명을 보지 않고 내품명만으로 본품을 찾은 규칙.
 * 품목명 원장 exact 매칭까지 성공하면 내품명을 소비한 것으로 본다.
 */
export function productNameRuleConsumesItemName(rule: string | null) {
  return Boolean(rule && ITEM_ONLY_PRODUCT_RULES.has(rule))
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

function isEmptyHint(value: string) {
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

/** `REGEXEXTRACT(value, "/(.*)$")`와 같다. 첫 슬래시 뒤 전체를 돌려준다. */
function suffixAfterSlash(value: string): string | null {
  const at = value.indexOf('/')
  if (at < 0) return null
  return value.slice(at + 1)
}

/** `REGEXEXTRACT(value, "^(Color:\s*[^:]+)")`와 같다. Color: 라벨을 키에 남긴다. */
function colorLabelPrefix(value: string): string | null {
  const match = /^(Color:\s*[^:]+)/.exec(value)
  return match ? (match[1] ?? null) : null
}

/**
 * `파우치 선택: 180 HP_...`는 첫 콜론 뒤 값, `180 HP_...`는 전체를 쓴다.
 */
function itemValueOnly(value: string) {
  const colonIndexes = [value.indexOf(':'), value.indexOf('：')].filter(
    (index) => index >= 0,
  )
  if (colonIndexes.length === 0) return value.trim()
  return value.slice(Math.min(...colonIndexes) + 1).trim()
}

/** SSG 열은 SSG 몰에만 쓴다. 다른 몰에서는 후보로 만들지 않는다. */
export function isSsgMall(mallName: string) {
  return /ssg|쓱/.test(normalizeInvoiceText(mallName))
}

/**
 * 기존 시트의 조회 키 후보를 그대로 만든다. 왼쪽 열이 먼저 맞으면 그 값이 정답이므로
 * 반환 순서가 우선순위다. 내품명은 조회 문맥일 뿐이라 어떤 후보도 내품명을 바꾸지 않는다.
 */
export function generateProductNameCandidates(input: {
  productName: string
  itemName: string
  mallName?: string
  ownProductCode?: string
}): ProductNameCandidate[] {
  const productName = input.productName.trim()
  const itemName = input.itemName.trim()
  const mallName = input.mallName?.trim() ?? ''
  const ownProductCode = input.ownProductCode?.trim() ?? ''
  const output: ProductNameCandidate[] = []
  const seen = new Set<string>()

  pushCandidate(
    output,
    seen,
    `${productName} ${itemName}`,
    'product_item',
    '품목명 한 칸 띄고 내품명 전체',
  )

  const slashPrefix = prefixBefore(itemName, '/')
  const commaPrefix = prefixBefore(itemName, ',')
  const colorPrefix = colorLabelPrefix(itemName)
  const colonPrefix = prefixBefore(itemName, ':')

  // 시트 열 순서 그대로다. 구분자가 없는 열은 IFERROR로 품목명 단독이 되므로,
  // 품목명 단독도 그 열의 자리에서만 조회 키가 된다.
  const combinedColumns: [string, string | null, string][] = [
    ['product_item_slash_prefix', slashPrefix, '품목명 + 내품명 첫 / 앞부분'],
    ['product_item_comma_prefix', commaPrefix, '품목명 + 내품명 첫 , 앞부분'],
    ['product_item_color_label', colorPrefix, '품목명 + 내품명 Color: 라벨 구간'],
    ['product_item_colon_prefix', colonPrefix, '품목명 + 내품명 첫 : 앞부분'],
  ]
  for (const [rule, extracted, reason] of combinedColumns) {
    if (extracted === null) {
      pushCandidate(
        output,
        seen,
        productName,
        'product',
        '품목명 단독 (구분자가 없는 열의 IFERROR 값)',
      )
      continue
    }
    pushCandidate(
      output,
      seen,
      `${productName} ${sheetTrim(extracted)}`,
      rule,
      reason,
    )
  }

  if (slashPrefix !== null && !isEmptyHint(slashPrefix)) {
    pushCandidate(
      output,
      seen,
      slashPrefix,
      'item_slash_prefix',
      '내품명 첫 / 앞부분 단독',
    )
  }

  if (commaPrefix !== null && !isEmptyHint(commaPrefix)) {
    pushCandidate(
      output,
      seen,
      commaPrefix,
      'item_comma_prefix',
      '내품명 첫 , 앞부분 단독',
    )
  }

  if (itemName && !isEmptyHint(itemName)) {
    pushCandidate(
      output,
      seen,
      itemName,
      'item_full',
      '품목명을 보지 않고 내품명 전체만 사용',
    )
  }

  const itemValue = itemValueOnly(itemName)
  if (itemValue && !isEmptyHint(itemValue)) {
    pushCandidate(
      output,
      seen,
      itemValue,
      'item_value',
      '품목명을 보지 않고 내품명 옵션값만 사용',
    )
  }

  const slashSuffix = isSsgMall(mallName) ? suffixAfterSlash(itemName) : null
  if (slashSuffix !== null && !isEmptyHint(slashSuffix)) {
    pushCandidate(
      output,
      seen,
      slashSuffix,
      'item_slash_suffix',
      'SSG 전용: 내품명 첫 / 뒷부분 단독',
    )
  }

  if (ownProductCode) {
    pushCandidate(
      output,
      seen,
      ownProductCode,
      'own_code',
      '자체상품코드 보조 힌트',
    )
  }

  return output
}

export function collectProductNameCandidateTexts(
  rows: {
    productName: string
    itemName: string
    mallName?: string
    ownProductCode?: string
  }[],
): string[] {
  const seen = new Set<string>()
  const texts: string[] = []
  for (const row of rows) {
    for (const candidate of generateProductNameCandidates(row)) {
      const key = normalizeInvoiceText(candidate.text)
      if (seen.has(key)) continue
      seen.add(key)
      texts.push(candidate.text)
    }
  }
  return texts
}
