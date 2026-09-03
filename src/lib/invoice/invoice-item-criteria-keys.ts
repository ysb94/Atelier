import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type { InvoiceProductNameTransformRow } from '@/lib/invoice/product-name-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type { InvoiceItemNameRule, InvoiceOptionMap } from '@/lib/types'

export type OptionMapLookupCombo = {
  mallName: string
  productName: string
  itemName: string
}

function pushUniqueText(target: Set<string>, value: string) {
  const next = value.trim()
  if (next) target.add(next)
}

function pushUniqueCombo(
  target: Map<string, OptionMapLookupCombo>,
  mallName: string,
  productName: string,
  itemName: string,
) {
  const combo: OptionMapLookupCombo = {
    mallName,
    productName,
    itemName,
  }
  const key = [
    normalizeInvoiceText(mallName),
    normalizeInvoiceText(productName),
    normalizeInvoiceText(itemName),
  ].join('\u0000')
  if (!target.has(key)) target.set(key, combo)
}

/** 업로드 행·품목명 단계 잔여 내품명으로 옵션맵 조회 조합을 모은다. */
export function collectOptionMapLookupCombos(
  sourceRows: SabangnetOrderRow[],
  productRows: InvoiceProductNameTransformRow[] = [],
): OptionMapLookupCombo[] {
  const byKey = new Map<string, OptionMapLookupCombo>()
  for (const source of sourceRows) {
    pushUniqueCombo(byKey, source.mallName, source.productName, source.itemName)
  }
  for (const row of productRows) {
    const source = row.source
    pushUniqueCombo(
      byKey,
      source.mallName,
      source.productName,
      row.effectiveItemName,
    )
  }
  return [...byKey.values()]
}

/** 원문·잔여 내품명으로 내품명 규칙 조회 키를 모은다. */
export function collectItemNameLookupTexts(
  sourceRows: SabangnetOrderRow[],
  productRows: InvoiceProductNameTransformRow[] = [],
): string[] {
  const texts = new Set<string>()
  for (const source of sourceRows) {
    pushUniqueText(texts, source.itemName)
  }
  for (const row of productRows) {
    pushUniqueText(texts, row.effectiveItemName)
    pushUniqueText(texts, row.source.itemName)
  }
  return [...texts]
}

export function optionMapMatchesLookupCombo(
  map: InvoiceOptionMap,
  combo: OptionMapLookupCombo,
) {
  const product = normalizeInvoiceText(combo.productName)
  const item = normalizeInvoiceText(combo.itemName)
  const mall = normalizeInvoiceText(combo.mallName)
  if (map.normalizedProductName !== product) return false
  if (map.normalizedItemName !== item) return false
  return !map.normalizedMallName || map.normalizedMallName === mall
}

export function filterOptionMapsForCombos(
  maps: InvoiceOptionMap[],
  combos: OptionMapLookupCombo[],
) {
  if (combos.length === 0) return []
  return maps.filter((map) =>
    combos.some((combo) => optionMapMatchesLookupCombo(map, combo)),
  )
}

export function filterItemNameRulesForTexts(
  rules: InvoiceItemNameRule[],
  texts: string[],
) {
  if (texts.length === 0) return []
  const keys = new Set(
    texts.map((text) => normalizeInvoiceText(text)).filter(Boolean),
  )
  return rules.filter((rule) => keys.has(rule.normalizedItemName))
}
