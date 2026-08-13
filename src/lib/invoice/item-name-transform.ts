import {
  buildOutgoingComponentRows,
  formatOptionItemName,
  type InvoiceOptionTransformRow,
  type InvoiceOutgoingComponentRow,
} from '@/lib/invoice/option-transform'
import type { InvoiceProductNameTransformRow } from '@/lib/invoice/product-name-transform'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type {
  InvoiceOptionMap,
  InvoiceOptionMapComponent,
  StyleRef,
} from '@/lib/types'

export type InvoiceItemNameMatchStatus =
  | 'mapped'
  | 'consumed'
  | 'passthrough'
  | 'conflict'
  | 'unresolved'

export type InvoiceItemNameTransformRow = {
  source: SabangnetOrderRow
  status: InvoiceItemNameMatchStatus
  mapId: string | null
  productStyle: StyleRef | null
  extras: InvoiceOptionMapComponent[]
  transformedItemName: string
  displayChanged: boolean
}

export type UnresolvedItemNameCombo = {
  key: string
  mallName: string
  productName: string
  itemName: string
  ownProductCode: string
  productStyle: StyleRef | null
  rowCount: number
  status: 'unresolved' | 'conflict' | 'passthrough'
}

export type InvoiceItemNameTransformation = {
  rows: InvoiceItemNameTransformRow[]
  mappedRowCount: number
  consumedRowCount: number
  passthroughRowCount: number
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

/**
 * 확정된 본품과 원본 내품명으로 표시 내품명·물리 구성만 계산한다.
 * 승인된 내품명 규칙이 없으면 원문을 유지하며 `-`나 구성 요약으로 덮지 않는다.
 * 단, 내품명 단독 조회 키가 품목명 원장과 exact 매칭되면 그 값은 본품 식별에
 * 소비됐으므로 최종 내품명을 비운다.
 */
export function transformInvoiceItemNames(
  sourceRows: SabangnetOrderRow[],
  maps: InvoiceOptionMap[],
  productRows: InvoiceProductNameTransformRow[] = [],
): InvoiceItemNameTransformation {
  const activeMaps = maps.filter((map) => map.isActive)
  const productByRow = new Map(
    productRows.map((row) => [row.source.rowNumber, row]),
  )
  const unresolvedByKey = new Map<string, UnresolvedItemNameCombo>()
  let mappedRowCount = 0
  let consumedRowCount = 0
  let passthroughRowCount = 0
  let unresolvedRowCount = 0
  let conflictRowCount = 0

  function remember(
    source: SabangnetOrderRow,
    status: 'unresolved' | 'conflict' | 'passthrough',
    productStyle: StyleRef | null,
  ) {
    const key = comboKey(source.mallName, source.productName, source.itemName)
    const current = unresolvedByKey.get(key)
    if (current) {
      current.rowCount += 1
      if (status === 'conflict') current.status = 'conflict'
      return
    }
    unresolvedByKey.set(key, {
      key,
      mallName: source.mallName,
      productName: source.productName,
      itemName: source.itemName,
      ownProductCode: source.ownProductCode,
      productStyle,
      rowCount: 1,
      status,
    })
  }

  const rows = sourceRows.map((source): InvoiceItemNameTransformRow => {
    const product = productByRow.get(source.rowNumber)
    const productStyle = product?.style ?? null
    const itemNameConsumed = product?.itemNameConsumed ?? false
    const matches = pickMaps(
      activeMaps,
      source.mallName,
      source.productName,
      source.itemName,
    )
    if (matches.length === 1) {
      const map = matches[0]!
      const display = map.displayItemName.trim()
      if (itemNameConsumed) {
        consumedRowCount += 1
        return {
          source,
          status: 'consumed',
          mapId: map.id,
          productStyle:
            map.components.find((item) => item.role === 'main')?.style ??
            productStyle,
          extras: extrasOf(map),
          transformedItemName: '',
          displayChanged: Boolean(source.itemName),
        }
      }
      mappedRowCount += 1
      return {
        source,
        status: 'mapped',
        mapId: map.id,
        productStyle:
          map.components.find((item) => item.role === 'main')?.style ??
          productStyle,
        extras: extrasOf(map),
        transformedItemName: display || source.itemName,
        displayChanged: Boolean(display) && display !== source.itemName,
      }
    }
    if (matches.length > 1) {
      conflictRowCount += 1
      remember(source, 'conflict', productStyle)
      return {
        source,
        status: 'conflict',
        mapId: null,
        productStyle,
        extras: [],
        transformedItemName: source.itemName,
        displayChanged: false,
      }
    }

    if (itemNameConsumed) {
      consumedRowCount += 1
      return {
        source,
        status: 'consumed',
        mapId: product?.mapId ?? null,
        productStyle,
        extras: [],
        transformedItemName: '',
        displayChanged: Boolean(source.itemName),
      }
    }

    unresolvedRowCount += 1
    passthroughRowCount += 1
    remember(source, 'passthrough', productStyle)
    return {
      source,
      status: 'passthrough',
      mapId: null,
      productStyle,
      extras: [],
      transformedItemName: source.itemName,
      displayChanged: false,
    }
  })

  return {
    rows,
    mappedRowCount,
    consumedRowCount,
    passthroughRowCount,
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
  if (row.extras.length > 0) return formatOptionItemName(row.extras)
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
          item?.transformedItemName ?? product.source.itemName,
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
