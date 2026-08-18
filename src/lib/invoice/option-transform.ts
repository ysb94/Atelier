import { normalizeInvoiceCode } from '@/lib/invoice/name-transform'
import type {
  InvoiceNameTransformation,
  InvoiceNameTransformRow,
} from '@/lib/invoice/name-transform'
import { transformInvoiceNamesByCode } from '@/lib/invoice/name-transform'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type {
  InvoiceNameRule,
  InvoiceOptionComponentRole,
  InvoiceOptionMap,
  InvoiceOptionMapComponent,
  StyleRef,
} from '@/lib/types'

export type InvoiceOptionMatchStatus =
  | 'mapped'
  | 'code_fallback'
  | 'exception'
  | 'unresolved'
  | 'conflict'

export type InvoiceOptionTransformRow = {
  source: SabangnetOrderRow
  status: InvoiceOptionMatchStatus
  mapId: string | null
  main: StyleRef | null
  extras: InvoiceOptionMapComponent[]
  transformedName: string
  transformedItemName: string
  codeHintName: string | null
}

export type UnresolvedInvoiceCombo = {
  key: string
  mallName: string
  productName: string
  itemName: string
  ownProductCode: string
  rowCount: number
  status: 'unresolved' | 'conflict'
  codeHintName: string | null
}

export type InvoiceOptionTransformation = {
  rows: InvoiceOptionTransformRow[]
  mappedRowCount: number
  codeFallbackRowCount: number
  exceptionRowCount: number
  unresolvedRowCount: number
  conflictRowCount: number
  unresolvedCombos: UnresolvedInvoiceCombo[]
}

const EMPTY_ITEM_ALIASES = new Set([
  '',
  '-',
  '선택안함',
  'free',
  'one color',
  'onecolor',
])

export function isEmptyOptionItem(value: string): boolean {
  const key = normalizeInvoiceText(value).replace(/\s+/g, '')
  return EMPTY_ITEM_ALIASES.has(key)
}

export function optionLookupItemName(value: string): string {
  return isEmptyOptionItem(value) ? '' : value.trim()
}

export function formatOptionItemName(
  extras: InvoiceOptionMapComponent[],
): string {
  if (extras.length === 0) return '-'
  return extras
    .map((item) => {
      const prefix =
        item.role === 'included'
          ? '포함'
          : item.role === 'required'
            ? '필수'
            : '추가'
      const qty = item.quantity > 1 ? `×${item.quantity}` : ''
      return `${prefix}:${item.style.styleNo} ${item.style.name}${qty}`
    })
    .join(' + ')
}

function comboKey(
  mallName: string,
  productName: string,
  itemName: string,
): string {
  return [
    normalizeInvoiceText(mallName),
    normalizeInvoiceText(productName),
    normalizeInvoiceText(optionLookupItemName(itemName)),
  ].join('\u0000')
}

function mainOf(map: InvoiceOptionMap): StyleRef | null {
  return map.components.find((item) => item.role === 'main')?.style ?? null
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
  const item = normalizeInvoiceText(optionLookupItemName(itemName))
  const exact = maps.filter(
    (map) =>
      map.normalizedMallName === mall &&
      map.normalizedProductName === product &&
      map.normalizedItemName === item,
  )
  if (exact.length > 0) return exact

  const noMall = maps.filter(
    (map) =>
      !map.normalizedMallName &&
      map.normalizedProductName === product &&
      map.normalizedItemName === item,
  )
  if (noMall.length > 0) return noMall
  return []
}

function mappedRow(
  source: SabangnetOrderRow,
  map: InvoiceOptionMap,
): InvoiceOptionTransformRow {
  const main = mainOf(map)
  const extras = extrasOf(map)
  return {
    source,
    status: 'mapped',
    mapId: map.id,
    main,
    extras,
    transformedName: main?.name ?? source.productName,
    transformedItemName: map.displayItemName.trim() || source.itemName,
    codeHintName: null,
  }
}

/**
 * 품목명·내품명 조합 기준을 우선하고, 없을 때만 자체품번코드 규칙을 보조로 쓴다.
 * 내품명이 있는 미등록 조합은 코드가 있어도 검토 대상으로 남긴다.
 */
export function transformInvoiceOptions(
  sourceRows: SabangnetOrderRow[],
  maps: InvoiceOptionMap[],
  nameRules: InvoiceNameRule[],
): InvoiceOptionTransformation {
  const activeMaps = maps.filter((map) => map.isActive)
  const codeResult = transformInvoiceNamesByCode(sourceRows, nameRules)
  const codeByRow = new Map(
    codeResult.rows.map((row) => [row.source.rowNumber, row]),
  )
  const unresolvedByKey = new Map<string, UnresolvedInvoiceCombo>()

  let mappedRowCount = 0
  let codeFallbackRowCount = 0
  let exceptionRowCount = 0
  let unresolvedRowCount = 0
  let conflictRowCount = 0

  function remember(
    source: SabangnetOrderRow,
    status: 'unresolved' | 'conflict',
    codeHintName: string | null,
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
      itemName: optionLookupItemName(source.itemName),
      ownProductCode: source.ownProductCode,
      rowCount: 1,
      status,
      codeHintName,
    })
  }

  const rows = sourceRows.map((source): InvoiceOptionTransformRow => {
    const matches = pickMaps(
      activeMaps,
      source.mallName,
      source.productName,
      source.itemName,
    )
    if (matches.length === 1) {
      mappedRowCount += 1
      return mappedRow(source, matches[0]!)
    }
    if (matches.length > 1) {
      conflictRowCount += 1
      remember(source, 'conflict', null)
      return {
        source,
        status: 'conflict',
        mapId: null,
        main: null,
        extras: [],
        transformedName: source.productName,
        transformedItemName: source.itemName,
        codeHintName: null,
      }
    }

    const codeRow = codeByRow.get(source.rowNumber)
    const emptyItem = isEmptyOptionItem(source.itemName)
    const matchedRule = nameRules.find(
      (rule) => rule.id === codeRow?.matchedRuleId,
    )
    if (emptyItem && codeRow?.status === 'renamed') {
      codeFallbackRowCount += 1
      const main =
        matchedRule?.targetStyleId && matchedRule.targetName
          ? {
              styleId: matchedRule.targetStyleId,
              styleNo: matchedRule.targetStyleNo ?? '',
              name: matchedRule.targetName,
            }
          : {
              styleId: '',
              styleNo: '',
              name: codeRow.transformedName,
            }
      return {
        source,
        status: 'code_fallback',
        mapId: null,
        main,
        extras: [],
        transformedName: codeRow.transformedName,
        transformedItemName: source.itemName,
        codeHintName: codeRow.transformedName,
      }
    }
    if (emptyItem && codeRow?.status === 'exception') {
      exceptionRowCount += 1
      return {
        source,
        status: 'exception',
        mapId: null,
        main: null,
        extras: [],
        transformedName: source.productName,
        transformedItemName: source.itemName,
        codeHintName: null,
      }
    }

    unresolvedRowCount += 1
    const hint =
      codeRow?.status === 'renamed' ? codeRow.transformedName : null
    remember(source, 'unresolved', hint)
    return {
      source,
      status: 'unresolved',
      mapId: null,
      main: null,
      extras: [],
      transformedName: source.productName,
      transformedItemName: source.itemName,
      codeHintName: hint,
    }
  })

  return {
    rows,
    mappedRowCount,
    codeFallbackRowCount,
    exceptionRowCount,
    unresolvedRowCount,
    conflictRowCount,
    unresolvedCombos: [...unresolvedByKey.values()].sort(
      (left, right) =>
        right.rowCount - left.rowCount ||
        left.productName.localeCompare(right.productName, 'ko-KR'),
    ),
  }
}

export function optionTransformationToName(
  option: InvoiceOptionTransformation,
): InvoiceNameTransformation {
  const rows: InvoiceNameTransformRow[] = option.rows.map((row) => ({
    source: row.source,
    transformedName: row.transformedName,
    status:
      row.status === 'mapped' || row.status === 'code_fallback'
        ? 'renamed'
        : row.status === 'exception'
          ? 'exception'
          : row.status === 'conflict'
            ? 'unmapped_code'
            : row.source.ownProductCode.trim()
              ? 'unmapped_code'
              : 'missing_code',
    matchedRuleId: row.mapId,
  }))
  return {
    rows,
    renamedRowCount: option.mappedRowCount + option.codeFallbackRowCount,
    exceptionRowCount: option.exceptionRowCount,
    unmappedCodeRowCount: option.unresolvedRowCount + option.conflictRowCount,
    missingCodeRowCount: option.rows.filter(
      (row) =>
        row.status === 'unresolved' && !row.source.ownProductCode.trim(),
    ).length,
    unresolvedCodes: [],
  }
}

export function parseOrderQuantity(value: string): number {
  const parsed = Number(String(value).replace(/,/g, '').trim())
  if (!Number.isFinite(parsed) || parsed <= 0) return 1
  return parsed
}

export type InvoiceOutputBundleLine = {
  productName: string
  quantity: string
}

/**
 * 추가 구성품이 있으면 본품 다음에 구성품 행을 펼친다.
 * 수량은 원본 내품수량 × 구성 수량이다.
 */
export function resolveInvoiceOutputBundle(options: {
  sourceQuantity: string
  baseName: string
  main: StyleRef | null
  extras: InvoiceOptionMapComponent[]
  expandable: boolean
}): InvoiceOutputBundleLine[] {
  if (!options.expandable || options.extras.length === 0) {
    return [
      {
        productName: options.baseName,
        quantity: options.sourceQuantity,
      },
    ]
  }
  const orderQty = parseOrderQuantity(options.sourceQuantity)
  return [
    {
      productName: options.main?.name || options.baseName,
      quantity: String(orderQty),
    },
    ...options.extras.map((extra) => ({
      productName: extra.style.name,
      quantity: String(orderQty * extra.quantity),
    })),
  ]
}

export type InvoiceOutgoingComponentRow = {
  sourceRowNumber: number
  customerOrderNo: string
  mallName: string
  productName: string
  itemName: string
  role: InvoiceOptionComponentRole | 'gift' | 'unknown' | 'packing'
  styleNo: string
  styleName: string
  quantity: number
  source: 'map' | 'code' | 'gift' | 'unresolved' | 'packing'
}

export function buildOutgoingComponentRows(options: {
  optionRows: InvoiceOptionTransformRow[]
  giftRowsBySource: Map<number, SabangnetOrderRow[]>
  packingMaterials?: {
    styleNo: string
    name: string
    count: number
  }[]
}): InvoiceOutgoingComponentRow[] {
  const output: InvoiceOutgoingComponentRow[] = []
  for (const row of options.optionRows) {
    const orderQty = parseOrderQuantity(row.source.quantity)
    if (row.main && row.main.styleNo) {
      output.push({
        sourceRowNumber: row.source.rowNumber,
        customerOrderNo: row.source.customerOrderNo,
        mallName: row.source.mallName,
        productName: row.source.productName,
        itemName: row.source.itemName,
        role: 'main',
        styleNo: row.main.styleNo,
        styleName: row.main.name,
        quantity: orderQty,
        source: row.status === 'mapped' ? 'map' : 'code',
      })
    } else if (row.status === 'mapped' || row.status === 'code_fallback') {
      output.push({
        sourceRowNumber: row.source.rowNumber,
        customerOrderNo: row.source.customerOrderNo,
        mallName: row.source.mallName,
        productName: row.source.productName,
        itemName: row.source.itemName,
        role: 'main',
        styleNo: '',
        styleName: row.transformedName,
        quantity: orderQty,
        source: row.status === 'mapped' ? 'map' : 'code',
      })
    } else {
      output.push({
        sourceRowNumber: row.source.rowNumber,
        customerOrderNo: row.source.customerOrderNo,
        mallName: row.source.mallName,
        productName: row.source.productName,
        itemName: row.source.itemName,
        role: 'unknown',
        styleNo: '',
        styleName: row.transformedName,
        quantity: orderQty,
        source: 'unresolved',
      })
    }
    for (const extra of row.extras) {
      output.push({
        sourceRowNumber: row.source.rowNumber,
        customerOrderNo: row.source.customerOrderNo,
        mallName: row.source.mallName,
        productName: row.source.productName,
        itemName: row.source.itemName,
        role: extra.role,
        styleNo: extra.style.styleNo,
        styleName: extra.style.name,
        quantity: orderQty * extra.quantity,
        source: 'map',
      })
    }
    const gifts = options.giftRowsBySource.get(row.source.rowNumber) ?? []
    for (const gift of gifts) {
      output.push({
        sourceRowNumber: row.source.rowNumber,
        customerOrderNo: gift.customerOrderNo,
        mallName: gift.mallName,
        productName: gift.productName,
        itemName: gift.itemName,
        role: 'gift',
        styleNo: '',
        styleName: gift.productName,
        quantity: parseOrderQuantity(gift.quantity),
        source: 'gift',
      })
    }
  }
  for (const material of options.packingMaterials ?? []) {
    output.push({
      sourceRowNumber: 0,
      customerOrderNo: '',
      mallName: '',
      productName: '',
      itemName: '',
      role: 'packing',
      styleNo: material.styleNo,
      styleName: material.name,
      quantity: material.count,
      source: 'packing',
    })
  }
  return output
}

export async function downloadOutgoingComponentRows(options: {
  brandName: string
  sourceFileName?: string
  rows: InvoiceOutgoingComponentRow[]
}) {
  const XLSX = await import('xlsx')
  const headers = [
    '원본행',
    '고객주문번호',
    '쇼핑몰명',
    '원본 품목명',
    '원본 내품명',
    '구분',
    'M번호',
    '공식 상품명',
    '수량',
    '출처',
  ]
  const roleLabel: Record<string, string> = {
    main: '본품',
    included: '기본포함',
    required: '필수옵션',
    paid_add: '유료추가',
    gift: '사은품',
    unknown: '미확정',
    packing: '포장재',
  }
  const sourceLabel: Record<string, string> = {
    map: '변환 기준',
    code: '자체품번',
    gift: '사은품',
    unresolved: '검토 필요',
    packing: '작업 지시',
  }
  const body = options.rows.map((row) => [
    row.sourceRowNumber,
    row.customerOrderNo,
    row.mallName,
    row.productName,
    row.itemName,
    roleLabel[row.role] ?? row.role,
    row.styleNo,
    row.styleName,
    row.quantity,
    sourceLabel[row.source] ?? row.source,
  ])
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...body])
  sheet['!cols'] = headers.map((header) => ({
    wch: Math.min(Math.max(header.length + 2, 14), 40),
  }))
  XLSX.utils.book_append_sheet(workbook, sheet, '출고구성')
  const stamp = new Date()
  const y = stamp.getFullYear()
  const m = String(stamp.getMonth() + 1).padStart(2, '0')
  const day = String(stamp.getDate()).padStart(2, '0')
  const base = (options.sourceFileName || options.brandName)
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim() || 'invoice'
  XLSX.writeFile(workbook, `${base}_출고구성_${y}${m}${day}.xlsx`)
}

export { normalizeInvoiceCode }
