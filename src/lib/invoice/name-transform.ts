import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type { InvoiceNameRule } from '@/lib/types'

export type InvoiceNameMatchStatus =
  | 'renamed'
  | 'exception'
  | 'unmapped_code'
  | 'missing_code'

export type InvoiceNameTransformRow = {
  source: SabangnetOrderRow
  transformedName: string
  status: InvoiceNameMatchStatus
  matchedRuleId: string | null
}

export type UnresolvedInvoiceCode = {
  normalizedCode: string
  ownProductCode: string
  rowCount: number
  productNames: string[]
  itemNames: string[]
}

export type InvoiceNameTransformation = {
  rows: InvoiceNameTransformRow[]
  renamedRowCount: number
  exceptionRowCount: number
  unmappedCodeRowCount: number
  missingCodeRowCount: number
  unresolvedCodes: UnresolvedInvoiceCode[]
}

/**
 * DB 생성 열과 같은 규칙을 쓴다.
 * 자체품번코드 원문은 바꾸지 않고 exact-match용 비교 문자열만 정리한다.
 */
export function normalizeInvoiceCode(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ko-KR')
}

function buildCodeRuleIndex(rules: InvoiceNameRule[]) {
  const index = new Map<string, InvoiceNameRule>()
  for (const rule of rules) {
    if (!rule.isActive || rule.matchType !== 'own_product_code') continue
    const key =
      rule.normalizedSourceValue || normalizeInvoiceCode(rule.sourceValue)
    if (!key || index.has(key)) continue
    index.set(key, rule)
  }
  return index
}

export function transformInvoiceNamesByCode(
  sourceRows: SabangnetOrderRow[],
  rules: InvoiceNameRule[],
): InvoiceNameTransformation {
  const rulesByCode = buildCodeRuleIndex(rules)
  const unresolvedByCode = new Map<
    string,
    {
      ownProductCode: string
      rowCount: number
      productNames: Set<string>
      itemNames: Set<string>
    }
  >()
  let renamedRowCount = 0
  let exceptionRowCount = 0
  let unmappedCodeRowCount = 0
  let missingCodeRowCount = 0

  const rows = sourceRows.map((source): InvoiceNameTransformRow => {
    const normalizedCode = normalizeInvoiceCode(source.ownProductCode)
    if (!normalizedCode) {
      missingCodeRowCount += 1
      return {
        source,
        transformedName: source.productName,
        status: 'missing_code',
        matchedRuleId: null,
      }
    }

    const rule = rulesByCode.get(normalizedCode)
    if (!rule) {
      unmappedCodeRowCount += 1
      const unresolved = unresolvedByCode.get(normalizedCode) ?? {
        ownProductCode: source.ownProductCode,
        rowCount: 0,
        productNames: new Set<string>(),
        itemNames: new Set<string>(),
      }
      unresolved.rowCount += 1
      if (source.productName) unresolved.productNames.add(source.productName)
      if (source.itemName) unresolved.itemNames.add(source.itemName)
      unresolvedByCode.set(normalizedCode, unresolved)
      return {
        source,
        transformedName: source.productName,
        status: 'unmapped_code',
        matchedRuleId: null,
      }
    }

    if (rule.action === 'exception') {
      exceptionRowCount += 1
      return {
        source,
        transformedName: source.productName,
        status: 'exception',
        matchedRuleId: rule.id,
      }
    }

    renamedRowCount += 1
    return {
      source,
      transformedName: rule.targetName ?? source.productName,
      status: 'renamed',
      matchedRuleId: rule.id,
    }
  })

  return {
    rows,
    renamedRowCount,
    exceptionRowCount,
    unmappedCodeRowCount,
    missingCodeRowCount,
    unresolvedCodes: [...unresolvedByCode.entries()]
      .map(([normalizedCode, unresolved]) => ({
        normalizedCode,
        ownProductCode: unresolved.ownProductCode,
        rowCount: unresolved.rowCount,
        productNames: [...unresolved.productNames],
        itemNames: [...unresolved.itemNames],
      }))
      .sort(
        (left, right) =>
          right.rowCount - left.rowCount ||
          left.ownProductCode.localeCompare(right.ownProductCode, 'ko-KR'),
      ),
  }
}
