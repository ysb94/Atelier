import {
  buildOutgoingComponentRows,
  type InvoiceOptionTransformRow,
  type InvoiceOutgoingComponentRow,
} from '@/lib/invoice/option-transform'
import type { InvoiceProductNameTransformRow } from '@/lib/invoice/product-name-transform'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type {
  InvoiceItemNameRule,
  InvoiceItemNameRuleComponent,
  InvoiceOptionMap,
  InvoiceOptionMapComponent,
  StyleRef,
} from '@/lib/types'

export type InvoiceItemNameMatchStatus =
  | 'mapped'
  | 'passthrough'
  | 'consumed'
  | 'deleted'
  | 'conflict'
  | 'unresolved'

export type InvoiceItemNameTransformRow = {
  source: SabangnetOrderRow
  status: InvoiceItemNameMatchStatus
  mapId: string | null
  ruleId: string | null
  productStyle: StyleRef | null
  extras: InvoiceOptionMapComponent[]
  transformedItemName: string
  displayChanged: boolean
}

export type UnresolvedItemNameCombo = {
  key: string
  mallName: string
  productName: string
  /** 내품명 기준으로 쓸 값. 앞부분 소비면 suffix */
  itemName: string
  /** 사방넷 원본 내품명 */
  originalItemName: string
  ownProductCode: string
  productStyle: StyleRef | null
  mapId: string | null
  rowCount: number
  status: 'unresolved' | 'conflict' | 'passthrough'
}

export type InvoiceItemNameTransformation = {
  rows: InvoiceItemNameTransformRow[]
  mappedRowCount: number
  passthroughRowCount: number
  consumedRowCount: number
  deletedRowCount: number
  unresolvedRowCount: number
  conflictRowCount: number
  unresolvedCombos: UnresolvedItemNameCombo[]
}

function comboKey(mallName: string, productName: string, itemName: string) {
  return [
    normalizeInvoiceText(mallName),
    normalizeInvoiceText(productName),
    normalizeInvoiceText(itemName),
  ].join('\u0000')
}

function extrasOf(map: InvoiceOptionMap): InvoiceOptionMapComponent[] {
  return map.components.filter((item) => item.role !== 'main')
}

export function formatItemNameFromComponents(
  components: Array<Pick<InvoiceItemNameRuleComponent, 'style' | 'quantity'>>,
): string {
  return components
    .map((item) =>
      item.quantity > 1 ? `${item.style.name}×${item.quantity}` : item.style.name,
    )
    .join(' + ')
}

export function pickInvoiceItemNameRule(
  rules: InvoiceItemNameRule[],
  itemName: string,
  mainStyleId: string | null,
): InvoiceItemNameRule | null {
  const item = normalizeInvoiceText(itemName)
  if (!item) return null
  const active = rules.filter(
    (rule) => rule.isActive && rule.normalizedItemName === item,
  )
  if (mainStyleId) {
    const main = active.find(
      (rule) =>
        rule.scope === 'main_style' && rule.mainStyle?.styleId === mainStyleId,
    )
    if (main) return main
  }
  return active.find((rule) => rule.scope === 'global') ?? null
}

function extrasFromRule(rule: InvoiceItemNameRule): InvoiceOptionMapComponent[] {
  return rule.components.map((item, index) => ({
    id: item.id,
    mapId: rule.id,
    style: item.style,
    role: item.role,
    quantity: item.quantity,
    sortOrder: item.sortOrder ?? index,
  }))
}

function mergeExtras(
  primary: InvoiceOptionMapComponent[],
  secondary: InvoiceOptionMapComponent[],
): InvoiceOptionMapComponent[] {
  const seen = new Set(primary.map((item) => item.style.styleId))
  const merged = [...primary]
  for (const extra of secondary) {
    if (seen.has(extra.style.styleId)) continue
    seen.add(extra.style.styleId)
    merged.push(extra)
  }
  return merged
}

function pickMaps(
  maps: InvoiceOptionMap[],
  mallName: string,
  productName: string,
  itemName: string,
): InvoiceOptionMap[] {
  const mall = normalizeInvoiceText(mallName)
  const product = normalizeInvoiceText(productName)
  const item = normalizeInvoiceText(itemName)
  const exact = maps.filter(
    (map) =>
      map.normalizedMallName === mall &&
      map.normalizedProductName === product &&
      map.normalizedItemName === item,
  )
  if (exact.length > 0) return exact
  return maps.filter(
    (map) =>
      !map.normalizedMallName &&
      map.normalizedProductName === product &&
      map.normalizedItemName === item,
  )
}

function pickMapsPreferring(
  maps: InvoiceOptionMap[],
  mallName: string,
  productName: string,
  preferredItemName: string,
  fallbackItemName: string,
) {
  const preferred = pickMaps(maps, mallName, productName, preferredItemName)
  if (preferred.length > 0) return preferred
  if (preferredItemName !== fallbackItemName) {
    return pickMaps(maps, mallName, productName, fallbackItemName)
  }
  return []
}

/**
 * 확정된 본품과 유효 내품명으로 표시 내품명·물리 구성만 계산한다.
 * 우선순위는 본품별 규칙 → 공통 규칙 → 기존 invoice_option_maps → 원문 유지다.
 * 공통 규칙은 쇼핑몰·원본 품목명을 보지 않는다. 본품 미확정 행에는 본품별 규칙을 쓰지 않는다.
 * 원본·유효 내품명이 모두 비어 있으면 빈칸으로 통과하고 검토 목록에서 뺀다.
 * 품목명 원장이 내품명 전체 단독으로 본품을 확정한 행은 내품명을 비우고 검토 목록에서 뺀다.
 * 앞부분만 소비한 행은 남은 suffix로 내품명 기준을 찾고, 없으면 원문 조합 원장을 본다.
 * 구성만 저장된 기준은 세트 행 확장에 쓰되, 소비되지 않은 내품명은 유효 값을 유지한다.
 */
export function transformInvoiceItemNames(
  sourceRows: SabangnetOrderRow[],
  maps: InvoiceOptionMap[],
  productRows: InvoiceProductNameTransformRow[] = [],
  rules: InvoiceItemNameRule[] = [],
): InvoiceItemNameTransformation {
  const activeMaps = maps.filter((map) => map.isActive)
  const activeRules = rules.filter((rule) => rule.isActive)
  const productByRow = new Map(
    productRows.map((row) => [row.source.rowNumber, row]),
  )
  const unresolvedByKey = new Map<string, UnresolvedItemNameCombo>()
  let mappedRowCount = 0
  let passthroughRowCount = 0
  let consumedRowCount = 0
  let deletedRowCount = 0
  let unresolvedRowCount = 0
  let conflictRowCount = 0

  function remember(
    source: SabangnetOrderRow,
    itemName: string,
    status: 'unresolved' | 'conflict' | 'passthrough',
    productStyle: StyleRef | null,
    mapId: string | null = null,
  ) {
    const key = comboKey(source.mallName, source.productName, itemName)
    const current = unresolvedByKey.get(key)
    if (current) {
      current.rowCount += 1
      if (status === 'conflict') current.status = 'conflict'
      if (!current.mapId && mapId) current.mapId = mapId
      return
    }
    unresolvedByKey.set(key, {
      key,
      mallName: source.mallName,
      productName: source.productName,
      itemName,
      originalItemName: source.itemName,
      ownProductCode: source.ownProductCode,
      productStyle,
      mapId,
      rowCount: 1,
      status,
    })
  }

  const rows = sourceRows.map((source): InvoiceItemNameTransformRow => {
    const product = productByRow.get(source.rowNumber)
    const productStyle = product?.style ?? null
    const effectiveItemName = product?.effectiveItemName ?? source.itemName
    const matches = pickMapsPreferring(
      activeMaps,
      source.mallName,
      source.productName,
      effectiveItemName,
      source.itemName,
    )
    const mapExtras = matches.length === 1 ? extrasOf(matches[0]!) : []
    const consumed = Boolean(product?.itemNameConsumed)
    const blankItem =
      !effectiveItemName.trim() && !source.itemName.trim()
    const rule = consumed
      ? null
      : pickInvoiceItemNameRule(
          activeRules,
          effectiveItemName,
          productStyle?.styleId ?? null,
        )

    if (matches.length > 1 && !rule) {
      conflictRowCount += 1
      remember(source, effectiveItemName, 'conflict', productStyle)
      return {
        source,
        status: 'conflict',
        mapId: null,
        ruleId: null,
        productStyle,
        extras: [],
        transformedItemName: consumed ? '' : effectiveItemName,
        displayChanged: consumed || effectiveItemName !== source.itemName,
      }
    }

    const map = matches.length === 1 ? (matches[0] ?? null) : null
    const resolvedStyle =
      map?.components.find((item) => item.role === 'main')?.style ??
      productStyle

    if (consumed) {
      consumedRowCount += 1
      return {
        source,
        status: 'consumed',
        mapId: map?.id ?? null,
        ruleId: null,
        productStyle: resolvedStyle,
        extras: mapExtras,
        transformedItemName: '',
        displayChanged: Boolean(source.itemName),
      }
    }

    if (rule?.action === 'delete') {
      deletedRowCount += 1
      return {
        source,
        status: 'deleted',
        mapId: map?.id ?? null,
        ruleId: rule.id,
        productStyle: resolvedStyle,
        extras: [],
        transformedItemName: '',
        displayChanged: Boolean(source.itemName) || Boolean(effectiveItemName),
      }
    }

    if (rule?.action === 'components') {
      mappedRowCount += 1
      const extras = mergeExtras(extrasFromRule(rule), mapExtras)
      const display = formatItemNameFromComponents(rule.components)
      return {
        source,
        status: 'mapped',
        mapId: map?.id ?? null,
        ruleId: rule.id,
        productStyle: resolvedStyle,
        extras,
        transformedItemName: display,
        displayChanged: display !== source.itemName,
      }
    }

    if (map) {
      const display = map.displayItemName.trim()
      if (display) {
        mappedRowCount += 1
        return {
          source,
          status: 'mapped',
          mapId: map.id,
          ruleId: null,
          productStyle: resolvedStyle,
          extras: mapExtras,
          transformedItemName: display,
          displayChanged: display !== source.itemName,
        }
      }
      if (blankItem) {
        consumedRowCount += 1
        return {
          source,
          status: 'consumed',
          mapId: map.id,
          ruleId: null,
          productStyle: resolvedStyle,
          extras: mapExtras,
          transformedItemName: '',
          displayChanged: false,
        }
      }
      unresolvedRowCount += 1
      passthroughRowCount += 1
      remember(source, effectiveItemName, 'passthrough', resolvedStyle, map.id)
      return {
        source,
        status: 'passthrough',
        mapId: map.id,
        ruleId: null,
        productStyle: resolvedStyle,
        extras: mapExtras,
        transformedItemName: effectiveItemName,
        displayChanged: effectiveItemName !== source.itemName,
      }
    }

    if (blankItem) {
      consumedRowCount += 1
      return {
        source,
        status: 'consumed',
        mapId: null,
        ruleId: null,
        productStyle: resolvedStyle,
        extras: [],
        transformedItemName: '',
        displayChanged: false,
      }
    }

    unresolvedRowCount += 1
    passthroughRowCount += 1
    remember(source, effectiveItemName, 'passthrough', productStyle)
    return {
      source,
      status: 'passthrough',
      mapId: null,
      ruleId: null,
      productStyle,
      extras: [],
      transformedItemName: effectiveItemName,
      displayChanged: effectiveItemName !== source.itemName,
    }
  })

  return {
    rows,
    mappedRowCount,
    passthroughRowCount,
    consumedRowCount,
    deletedRowCount,
    unresolvedRowCount,
    conflictRowCount,
    unresolvedCombos: [...unresolvedByKey.values()].sort(
      (left, right) =>
        right.rowCount - left.rowCount ||
        left.productName.localeCompare(right.productName, 'ko-KR'),
    ),
  }
}

export function itemNamePreviewLabel(row: InvoiceItemNameTransformRow) {
  if (row.displayChanged) return row.transformedItemName
  return row.source.itemName
}

export function buildOutgoingComponentRowsFromStages(options: {
  productRows: InvoiceProductNameTransformRow[]
  itemRows: InvoiceItemNameTransformRow[]
  giftRowsBySource: Map<number, SabangnetOrderRow[]>
  packingMaterials?: {
    styleNo: string
    name: string
    count: number
  }[]
}): InvoiceOutgoingComponentRow[] {
  const itemByRow = new Map(
    options.itemRows.map((row) => [row.source.rowNumber, row]),
  )
  const optionRows: InvoiceOptionTransformRow[] = options.productRows.map(
    (product) => {
      const item = itemByRow.get(product.source.rowNumber)
      const mapped =
        product.status === 'mapped' || product.status === 'candidate'
      return {
        source: product.source,
        status: mapped ? 'mapped' : product.status === 'conflict' ? 'conflict' : 'unresolved',
        mapId: item?.mapId ?? product.mapId,
        main: product.style,
        extras: item?.extras ?? [],
        transformedName: product.transformedProductName,
        transformedItemName:
          item?.transformedItemName ??
          product.effectiveItemName ??
          product.source.itemName,
        codeHintName: null,
      }
    },
  )
  return buildOutgoingComponentRows({
    optionRows,
    giftRowsBySource: options.giftRowsBySource,
    packingMaterials: options.packingMaterials,
  })
}
