import type { GiftAssignmentPlan } from '@/lib/invoice/gift-assign'
import type { InvoiceItemNameTransformation } from '@/lib/invoice/item-name-transform'
import type {
  InvoiceNameTransformation,
  InvoiceNameTransformRow,
} from '@/lib/invoice/name-transform'
import type { InvoiceOptionTransformation } from '@/lib/invoice/option-transform'
import type { InvoiceProductNameTransformation } from '@/lib/invoice/product-name-transform'
import { productNameTransformationToName } from '@/lib/invoice/product-name-transform'
import type {
  WorkInstructionMatch,
  WorkInstructionPlan,
} from '@/lib/invoice/work-instruction-transform'
import { applyWorkInstructionLabel } from '@/lib/invoice/work-instruction-transform'
import {
  SABANGNET_COLUMNS,
  type SabangnetOrderRow,
} from '@/lib/invoice/sabangnet'

export type InvoiceOutputKind = 'order' | 'gift'

export type InvoiceOutputRow = SabangnetOrderRow & {
  kind: InvoiceOutputKind
  /** 최종 송장에 쓸 품목명(본품 공식명) */
  finalProductName: string
  /** 최종 송장에 쓸 내품명. 승인된 내품명 규칙이 없으면 원문 */
  finalItemName: string
  sourceRowNumber: number
}

/**
 * 품목명 단계 결과와 내품명 단계 결과를 마지막에만 합친다.
 * 한 단계의 실패가 다른 열을 되돌리거나 비우지 않는다.
 */
export function buildInvoiceOutputRows(options: {
  transformedRows: InvoiceNameTransformRow[]
  workMatches: Map<number, WorkInstructionMatch>
  giftRowsBySource: Map<number, SabangnetOrderRow[]>
  optionTransformation?: InvoiceOptionTransformation | null
  productTransformation?: InvoiceProductNameTransformation | null
  itemTransformation?: InvoiceItemNameTransformation | null
}): InvoiceOutputRow[] {
  const output: InvoiceOutputRow[] = []
  let nextRowNumber = 1
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

  for (const transformed of options.transformedRows) {
    const source = transformed.source
    const work = options.workMatches.get(source.rowNumber)
    const product = productBySource.get(source.rowNumber)
    const item = itemBySource.get(source.rowNumber)
    const option = optionBySource.get(source.rowNumber)
    const baseName =
      product?.transformedProductName ||
      option?.transformedName ||
      transformed.transformedName ||
      source.productName
    const finalProductName = work
      ? applyWorkInstructionLabel(work.labelText, baseName)
      : baseName
    const finalItemName = item
      ? item.transformedItemName
      : option
        ? option.transformedItemName
        : source.itemName

    output.push({
      ...source,
      rowNumber: nextRowNumber,
      kind: 'order',
      finalProductName,
      finalItemName,
      productName: finalProductName,
      itemName: finalItemName,
      sourceRowNumber: source.rowNumber,
    })
    nextRowNumber += 1

    const gifts = options.giftRowsBySource.get(source.rowNumber) ?? []
    for (const gift of gifts) {
      output.push({
        ...gift,
        rowNumber: nextRowNumber,
        kind: 'gift',
        finalProductName: gift.productName,
        finalItemName: '',
        sourceRowNumber: source.rowNumber,
      })
      nextRowNumber += 1
    }
  }

  return output
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
    productTransformation: includeProduct
      ? options.productTransformation
      : null,
    itemTransformation: includeItem ? options.itemTransformation : null,
    optionTransformation: includeItem ? options.optionTransformation : null,
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
