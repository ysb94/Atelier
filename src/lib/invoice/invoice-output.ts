import {
  formatGiftProductName,
  shipmentKeyOf,
  type GiftAssignment,
  type GiftAssignmentPlan,
} from '@/lib/invoice/gift-assign'
import type { InvoiceItemNameTransformation } from '@/lib/invoice/item-name-transform'
import type {
  InvoiceNameTransformation,
  InvoiceNameTransformRow,
} from '@/lib/invoice/name-transform'
import type { InvoiceOptionTransformation } from '@/lib/invoice/option-transform'
import { resolveInvoiceOutputBundle } from '@/lib/invoice/option-transform'
import type { InvoiceProductNameTransformation } from '@/lib/invoice/product-name-transform'
import { productNameTransformationToName } from '@/lib/invoice/product-name-transform'
import {
  formatInvoiceShipmentProductName,
  lookupInvoiceShipmentLabels,
  type InvoiceShipmentLabelLookups,
} from '@/lib/invoice/shipment-product-label'
import type {
  WorkInstructionMatch,
  WorkInstructionPlan,
} from '@/lib/invoice/work-instruction-transform'
import { applyWorkInstructionLabel } from '@/lib/invoice/work-instruction-transform'
import {
  SABANGNET_COLUMNS,
  type SabangnetOrderRow,
} from '@/lib/invoice/sabangnet'
import { normalizeStyleNo } from '@/lib/import/transform'

export type InvoiceOutputKind = 'order' | 'gift'

export type InvoiceOutputRow = SabangnetOrderRow & {
  kind: InvoiceOutputKind
  /** 최종 송장에 쓸 품목명(본품 공식명) */
  finalProductName: string
  /** 최종 송장에 쓸 내품명. 지우기·소비면 빈칸, 구성품 규칙이면 공식명 조합 */
  finalItemName: string
  sourceRowNumber: number
  /** 자리·포장 코드를 붙일 때 쓰는 연결 M번호. 없으면 원문 유지. */
  linkedStyleNo?: string | null
}

function canExpandInvoiceBundle(options: {
  productStatus?: string
  itemStatus?: string
  optionStatus?: string
}) {
  if (
    options.productStatus === 'conflict' ||
    options.productStatus === 'unresolved' ||
    options.productStatus === 'missing_style' ||
    options.productStatus === 'excluded' ||
    options.productStatus === 'exclusion_guarded' ||
    options.productStatus === 'gift_pending' ||
    options.productStatus === 'gift_mapped'
  ) {
    return false
  }
  if (options.itemStatus === 'conflict' || options.itemStatus === 'unresolved') {
    return false
  }
  if (
    options.optionStatus === 'conflict' ||
    options.optionStatus === 'unresolved'
  ) {
    return false
  }
  return true
}

/**
 * 품목명 단계 결과와 내품명 단계 결과를 마지막에만 합친다.
 * 한 단계의 실패가 다른 열을 되돌리거나 비우지 않는다.
 * 추가 구성품이 있으면 원본 고객정보를 복사한 CJ 행을 구성품 수만큼 펼친다.
 * 상품 연결 예외 행은 원문 품목명 1행과 자체품번코드를 남기고 내품명 규칙만 적용한다.
 * 세트·작업 지시·사은품은 상품 연결 예외 행에 붙이지 않는다.
 */
export function buildInvoiceOutputRows(options: {
  transformedRows?: InvoiceNameTransformRow[]
  workMatches: Map<number, WorkInstructionMatch>
  giftRowsBySource: Map<number, SabangnetOrderRow[]>
  giftAssignments?: GiftAssignment[]
  optionTransformation?: InvoiceOptionTransformation | null
  productTransformation?: InvoiceProductNameTransformation | null
  itemTransformation?: InvoiceItemNameTransformation | null
  /** false면 구성품만 펼치고 내품명은 아직 원문을 유지한다. */
  applyItemName?: boolean
}): InvoiceOutputRow[] {
  const output: InvoiceOutputRow[] = []
  let nextRowNumber = 1
  const sourceEntries =
    options.productTransformation?.rows ??
    options.transformedRows ??
    []
  const productBySource = new Map(
    (options.productTransformation?.rows ?? []).map((row) => [
      row.source.rowNumber,
      row,
    ]),
  )
  const itemBySource = new Map(
    (options.itemTransformation?.rows ?? []).map((row) => [
      row.source.rowNumber,
      row,
    ]),
  )
  const optionBySource = new Map(
    (options.optionTransformation?.rows ?? []).map((row) => [
      row.source.rowNumber,
      row,
    ]),
  )
  const giftAssignmentsBySource = new Map<number, GiftAssignment[]>()
  for (const assignment of options.giftAssignments ?? []) {
    const list = giftAssignmentsBySource.get(assignment.sourceRowNumber) ?? []
    list.push(assignment)
    giftAssignmentsBySource.set(assignment.sourceRowNumber, list)
  }

  for (const transformed of sourceEntries) {
    const source = transformed.source
    const product = productBySource.get(source.rowNumber)
    const item = itemBySource.get(source.rowNumber)
    const option = optionBySource.get(source.rowNumber)
    const transformedName =
      'transformedName' in transformed
        ? transformed.transformedName
        : product?.transformedProductName || source.productName
    const effectiveItemName = product?.effectiveItemName ?? source.itemName
    const finalItemName =
      item?.status === 'consumed' || item?.status === 'deleted'
        ? ''
        : options.applyItemName === false
          ? effectiveItemName
          : item
            ? item.transformedItemName
            : option
              ? option.transformedItemName
              : effectiveItemName
    if (product?.status === 'gift_mapped' && product.giftReplacements?.length) {
      for (const replacement of product.giftReplacements) {
        output.push({
          ...source,
          quantity: String(replacement.quantity),
          ownProductCode: '',
          rowNumber: nextRowNumber,
          kind: 'gift',
          finalProductName: replacement.style.name,
          finalItemName: '',
          productName: replacement.style.name,
          itemName: '',
          sourceRowNumber: source.rowNumber,
          linkedStyleNo: normalizeStyleNo(replacement.style.styleNo) || null,
        })
        nextRowNumber += 1
      }
      continue
    }
    if (product?.status === 'excluded') {
      output.push({
        ...source,
        rowNumber: nextRowNumber,
        kind: 'order',
        finalProductName: source.productName,
        finalItemName,
        productName: source.productName,
        itemName: finalItemName,
        sourceRowNumber: source.rowNumber,
        linkedStyleNo: null,
      })
      nextRowNumber += 1
      continue
    }
    const work = options.workMatches.get(source.rowNumber)
    const baseName =
      product?.transformedProductName ||
      option?.transformedName ||
      transformedName ||
      source.productName
    const extras = item
      ? item.expandableExtras
      : (option?.extras ?? [])
    const main = product?.style ?? item?.productStyle ?? option?.main ?? null
    const expandable = canExpandInvoiceBundle({
      productStatus: product?.status,
      itemStatus: item?.status,
      optionStatus: option?.status,
    })
    const lines = resolveInvoiceOutputBundle({
      sourceQuantity: source.quantity,
      baseName,
      main,
      extras,
      expandable,
    })

    for (const line of lines) {
      const finalProductName = work
        ? applyWorkInstructionLabel(work.labelText, line.productName)
        : line.productName
      output.push({
        ...source,
        quantity: line.quantity,
        rowNumber: nextRowNumber,
        kind: 'order',
        finalProductName,
        finalItemName,
        productName: finalProductName,
        itemName: finalItemName,
        sourceRowNumber: source.rowNumber,
        linkedStyleNo: normalizeStyleNo(line.style?.styleNo ?? '') || null,
      })
      nextRowNumber += 1
    }

    const gifts = options.giftRowsBySource.get(source.rowNumber) ?? []
    const giftAssignments = giftAssignmentsBySource.get(source.rowNumber) ?? []
    for (const [index, gift] of gifts.entries()) {
      const assignment = giftAssignments[index]
      output.push({
        ...gift,
        rowNumber: nextRowNumber,
        kind: 'gift',
        finalProductName: gift.productName,
        finalItemName: '',
        sourceRowNumber: source.rowNumber,
        linkedStyleNo: normalizeStyleNo(assignment?.styleNo ?? '') || null,
      })
      nextRowNumber += 1
    }
  }

  return numberGiftOutputRows(output)
}

const GIFT_LABEL_RE = /^사은품\(\d+\) : /

function officialGiftNameOf(value: string) {
  return value.replace(GIFT_LABEL_RE, '')
}

/** 품목명 대체·추가 사은품을 합포장마다 사은품(1)부터 다시 번호 매긴다. */
function numberGiftOutputRows(rows: InvoiceOutputRow[]) {
  const giftIndexByShipment = new Map<string, number>()
  return rows.map((row) => {
    if (row.kind !== 'gift') return row
    const key = shipmentKeyOf(row)
    const next = (giftIndexByShipment.get(key) ?? 0) + 1
    giftIndexByShipment.set(key, next)
    const label = formatGiftProductName(next, officialGiftNameOf(row.finalProductName))
    return {
      ...row,
      finalProductName: label,
      productName: label,
    }
  })
}

/** M번호 연결 행에 창고 자리·포장 코드를 붙인다. */
export function applyInvoiceShipmentProductLabels(
  rows: InvoiceOutputRow[],
  lookups: InvoiceShipmentLabelLookups,
): InvoiceOutputRow[] {
  return rows.map((row) => {
    const linkedStyleNo = normalizeStyleNo(row.linkedStyleNo ?? '') || null
    if (!linkedStyleNo) return { ...row, linkedStyleNo }
    const labels = lookupInvoiceShipmentLabels(linkedStyleNo, lookups)
    const labeled = formatInvoiceShipmentProductName({
      productName: row.finalProductName,
      locationLabel: labels.locationLabel,
      packingCode: labels.packingCode,
      linkedStyle: true,
    })
    if (labeled === row.finalProductName) {
      return { ...row, linkedStyleNo }
    }
    return {
      ...row,
      linkedStyleNo,
      finalProductName: labeled,
      productName: labeled,
    }
  })
}

export type InvoiceStepSnapshotStage =
  | 'check'
  | 'gift'
  | 'instruction'
  | 'product'
  | 'item'
  | 'transform'

export const INVOICE_STEP_SNAPSHOT_LABELS: Record<
  InvoiceStepSnapshotStage,
  string
> = {
  check: '파일확인',
  gift: '사은품추가',
  instruction: '작업지시',
  product: '품목명변환',
  item: '내품명변환',
  transform: '품목옵션변환',
}

function identityTransformRows(
  sourceRows: SabangnetOrderRow[],
): InvoiceNameTransformRow[] {
  return sourceRows.map((source) => ({
    source,
    transformedName: source.productName,
    status: 'missing_code',
    matchedRuleId: null,
  }))
}

/**
 * 해당 단계까지 누적된 전체 송장 행을 만든다.
 * 선착순 확정은 하지 않고, 화면에 보이는 미리보기 계획을 그대로 쓴다.
 */
export function buildInvoiceStepSnapshot(options: {
  stage: InvoiceStepSnapshotStage
  sourceRows: SabangnetOrderRow[]
  giftPlan?: GiftAssignmentPlan | null
  workPlan?: WorkInstructionPlan | null
  nameTransformation?: InvoiceNameTransformation | null
  optionTransformation?: InvoiceOptionTransformation | null
  productTransformation?: InvoiceProductNameTransformation | null
  itemTransformation?: InvoiceItemNameTransformation | null
}): InvoiceOutputRow[] {
  const emptyGifts = new Map<number, SabangnetOrderRow[]>()
  const emptyWork = new Map<number, WorkInstructionMatch>()
  const includeGifts = options.stage !== 'check'
  const includeWork =
    options.stage === 'instruction' ||
    options.stage === 'product' ||
    options.stage === 'item' ||
    options.stage === 'transform'
  const includeProduct =
    options.stage === 'product' ||
    options.stage === 'item' ||
    options.stage === 'transform'
  const includeItem = options.stage === 'item' || options.stage === 'transform'
  // 품목명 카드에서 함께 저장한 세트 구성은 품목명 단계 스냅샷부터 펼친다.
  // 내품명 문자열 변환 자체는 기존처럼 내품명 단계부터 적용한다.
  const includeBundle = includeProduct
  const transformation = includeProduct
    ? options.productTransformation
      ? productNameTransformationToName(options.productTransformation)
      : options.optionTransformation
        ? {
            rows: options.optionTransformation.rows.map((row) => ({
              source: row.source,
              transformedName: row.transformedName,
              status: 'renamed' as const,
              matchedRuleId: row.mapId,
            })),
            renamedRowCount: options.optionTransformation.mappedRowCount,
            exceptionRowCount: 0,
            unmappedCodeRowCount: 0,
            missingCodeRowCount: 0,
            unresolvedCodes: [],
          }
        : options.nameTransformation
    : null

  return buildInvoiceOutputRows({
    transformedRows: transformation
      ? transformation.rows
      : identityTransformRows(options.sourceRows),
    workMatches: includeWork
      ? (options.workPlan?.matchByRowNumber ?? emptyWork)
      : emptyWork,
    giftRowsBySource: includeGifts
      ? (options.giftPlan?.giftsBySourceRowNumber ?? emptyGifts)
      : emptyGifts,
    giftAssignments: includeGifts
      ? options.giftPlan?.shipments.flatMap((item) => item.assignments)
      : [],
    productTransformation: includeProduct
      ? options.productTransformation
      : null,
    itemTransformation: includeBundle ? options.itemTransformation : null,
    optionTransformation: includeItem ? options.optionTransformation : null,
    applyItemName: includeItem,
  })
}

function todayStamp() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

function safeFilePart(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'invoice'
}

/** 최종 송장 13열 XLSX를 내려받는다. */
export async function downloadInvoiceOutputRows(options: {
  brandName: string
  sourceFileName?: string
  rows: InvoiceOutputRow[]
}) {
  const XLSX = await import('xlsx')
  const headers = SABANGNET_COLUMNS.map((column) => column.label)
  const body = options.rows.map((row) =>
    SABANGNET_COLUMNS.map((column) => {
      if (column.key === 'productName') return row.finalProductName
      if (column.key === 'itemName') return row.finalItemName
      return row[column.key]
    }),
  )

  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...body])
  sheet['!cols'] = headers.map((header) => ({
    wch: Math.min(Math.max(header.length + 2, 12), 40),
  }))
  XLSX.utils.book_append_sheet(workbook, sheet, '송장작업')

  const base = options.sourceFileName
    ? safeFilePart(options.sourceFileName.replace(/\.[^.]+$/, ''))
    : safeFilePart(options.brandName)
  XLSX.writeFile(workbook, `${base}_송장작업_${todayStamp()}.xlsx`)
}

/** 단계까지 누적된 13열 XLSX를 내려받는다. */
export async function downloadInvoiceStepSnapshot(options: {
  stage: InvoiceStepSnapshotStage
  brandName: string
  sourceFileName?: string
  sourceRows: SabangnetOrderRow[]
  giftPlan?: GiftAssignmentPlan | null
  workPlan?: WorkInstructionPlan | null
  nameTransformation?: InvoiceNameTransformation | null
  optionTransformation?: InvoiceOptionTransformation | null
  productTransformation?: InvoiceProductNameTransformation | null
  itemTransformation?: InvoiceItemNameTransformation | null
}) {
  const XLSX = await import('xlsx')
  const rows = buildInvoiceStepSnapshot(options)
  const stageLabel = INVOICE_STEP_SNAPSHOT_LABELS[options.stage]
  const headers = SABANGNET_COLUMNS.map((column) => column.label)
  const includeItemName =
    options.stage === 'item' || options.stage === 'transform'
  const body = rows.map((row) =>
    SABANGNET_COLUMNS.map((column) => {
      if (column.key === 'productName') return row.finalProductName
      if (column.key === 'itemName' && includeItemName) {
        return row.finalItemName
      }
      if (column.key === 'itemName') return row.kind === 'gift' ? '' : row.itemName
      return row[column.key]
    }),
  )

  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...body])
  sheet['!cols'] = headers.map((header) => ({
    wch: Math.min(Math.max(header.length + 2, 12), 40),
  }))
  XLSX.utils.book_append_sheet(workbook, sheet, stageLabel)

  const base = options.sourceFileName
    ? safeFilePart(options.sourceFileName.replace(/\.[^.]+$/, ''))
    : safeFilePart(options.brandName)
  XLSX.writeFile(workbook, `${base}_${stageLabel}_${todayStamp()}.xlsx`)
}
