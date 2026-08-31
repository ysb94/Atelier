import { planInvoicePrefixes } from '@/lib/invoice/prefix-transform'
import { planUnifiedGifts } from '@/lib/invoice/gift-unified'
import {
  collectGiftSourceSlots,
  emptyGiftSourcePlan,
  type GiftSourceSessionRule,
  type GiftSourceSlot,
} from '@/lib/invoice/gift-source-transform'
import {
  planWorkInstructions,
  type WorkInstructionIndex,
} from '@/lib/invoice/work-instruction-transform'
import {
  catalogFromStyles,
  overlayGiftSourceOnProductNames,
  transformInvoiceProductNames,
  type InvoiceProductNameTransformation,
  type ProductNameLookupIndex,
  type ProductNameStyleCatalog,
} from '@/lib/invoice/product-name-transform'
import {
  buildOutgoingComponentRowsFromStages,
  transformInvoiceItemNames,
  type InvoiceItemNameTransformation,
  type ItemNameTransformIndex,
} from '@/lib/invoice/item-name-transform'
import { buildInvoiceOutputRows } from '@/lib/invoice/invoice-output'
import type { InvoiceOutputRow } from '@/lib/invoice/invoice-output'
import type { InvoiceOutgoingComponentRow } from '@/lib/invoice/option-transform'
import type { UnifiedGiftPlan } from '@/lib/invoice/gift-unified'
import type { InvoicePrefixPlan } from '@/lib/invoice/prefix-transform'
import type { WorkInstructionPlan } from '@/lib/invoice/work-instruction-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type {
  InvoiceAccessoryRule,
  InvoiceGiftAllocation,
  InvoiceGiftRequest,
  InvoiceGiftSourceAllocation,
  InvoiceGiftSourceMap,
  InvoiceItemNameRule,
  InvoiceOptionMap,
  InvoiceProductNameExclusion,
  InvoiceProductNameMap,
  InvoiceProductNameTagRoleEntry,
  InvoiceWorkInstruction,
  StyleRef,
} from '@/lib/types'

export type InvoiceWorkPipelineInput = {
  rows: SabangnetOrderRow[]
  styles: StyleRef[]
  productNameMaps: InvoiceProductNameMap[]
  productNameExclusions?: InvoiceProductNameExclusion[]
  productNameTagRoles?: InvoiceProductNameTagRoleEntry[]
  optionMaps?: InvoiceOptionMap[]
  itemNameRules?: InvoiceItemNameRule[]
  accessoryRules?: InvoiceAccessoryRule[]
  workInstructions?: InvoiceWorkInstruction[]
  giftRequests?: InvoiceGiftRequest[]
  giftAllocations?: InvoiceGiftAllocation[]
  giftSourceMaps?: InvoiceGiftSourceMap[]
  giftSourceAllocations?: InvoiceGiftSourceAllocation[]
  giftResolutions?: Record<string, string>
  giftSeed?: number
  excludedGiftStyleIds?: string[]
  sessionRules?: ReadonlyMap<string, GiftSourceSessionRule>
  sessionAllocations?: ReadonlyMap<string, StyleRef>
  ignoredKeys?: ReadonlySet<string>
  appliedKeys?: ReadonlySet<string>
  productLookupIndex?: ProductNameLookupIndex
  productCatalog?: ProductNameStyleCatalog
  itemNameIndex?: ItemNameTransformIndex
  workInstructionIndex?: WorkInstructionIndex
  giftSourceSlots?: GiftSourceSlot[]
}

export type InvoiceWorkPipelineResult = {
  eligibility: InvoicePrefixPlan
  unified: UnifiedGiftPlan
  workPlan: WorkInstructionPlan
  baseProduct: InvoiceProductNameTransformation
  product: InvoiceProductNameTransformation
  item: InvoiceItemNameTransformation
  list: InvoiceOutgoingComponentRow[]
  output: InvoiceOutputRow[]
}

export type InvoiceWorkSnapshot = {
  product: Array<{
    rowNumber: number
    status: string
    styleId: string
    name: string
    itemName: string
    quantity: string
  }>
  item: Array<{
    rowNumber: number
    status: string
    itemName: string
    extras: string
  }>
  gift: Array<{
    sourceRowNumber: number
    styleId: string
    quantity: number
  }>
  giftSource: Array<{
    rowNumber: number
    status: string
    replacements: string
  }>
  work: Array<{
    rowNumber: number
    instructionId: string
    label: string
  }>
  list: Array<{
    sourceRowNumber: number
    role: string
    styleNo: string
    quantity: number
  }>
  output: Array<{
    kind: string
    sourceRowNumber: number
    productName: string
    itemName: string
    quantity: string
  }>
}

export function runInvoiceWorkPipeline(
  input: InvoiceWorkPipelineInput,
): InvoiceWorkPipelineResult {
  const tagRoles = input.productNameTagRoles ?? []
  const catalog = input.productCatalog ?? catalogFromStyles(input.styles)
  const appliedKeys = input.appliedKeys ?? new Set<string>()
  const ignoredKeys = input.ignoredKeys
  const slots =
    input.giftSourceSlots ??
    collectGiftSourceSlots(input.rows, tagRoles, ignoredKeys, appliedKeys)
  const appliedRowNumbers = new Set(
    slots
      .filter((slot) => appliedKeys.has(slot.groupKey))
      .map((slot) => slot.source.rowNumber),
  )

  const baseProduct = transformInvoiceProductNames(
    input.rows,
    input.productNameMaps,
    catalog,
    tagRoles,
    input.productNameExclusions ?? [],
    input.productLookupIndex,
  )
  const excluded = new Set(
    baseProduct.rows
      .filter((row) => row.status === 'excluded')
      .map((row) => row.source.rowNumber),
  )
  const campaignRows = input.rows.filter(
    (row) => !excluded.has(row.rowNumber) && !appliedRowNumbers.has(row.rowNumber),
  )
  const processRows = input.rows.filter((row) => !excluded.has(row.rowNumber))
  const eligibility = planInvoicePrefixes(
    campaignRows,
    input.giftRequests ?? [],
    input.giftResolutions ?? {},
  )
  const unified = planUnifiedGifts({
    campaignRows,
    sourceRows: input.rows,
    prefixPlan: eligibility,
    requests: input.giftRequests ?? [],
    seed: input.giftSeed ?? 1,
    excludedGiftStyleIds: input.excludedGiftStyleIds,
    existingAllocations: input.giftAllocations,
    tagRoles,
    maps: input.giftSourceMaps,
    sourceAllocations: input.giftSourceAllocations,
    sessionRules: input.sessionRules,
    sessionAllocations: input.sessionAllocations,
    ignoredKeys,
    appliedKeys,
    sourceSlots: slots,
  })
  const workPlan = planWorkInstructions(
    processRows,
    input.workInstructions ?? [],
    input.workInstructionIndex,
  )
  const product = overlayGiftSourceOnProductNames(
    baseProduct,
    unified.giftSourcePlan ?? emptyGiftSourcePlan(),
  )
  const item = transformInvoiceItemNames(
    input.rows,
    input.optionMaps ?? [],
    product.rows,
    input.itemNameRules ?? [],
    input.accessoryRules ?? [],
    input.styles,
    input.itemNameIndex,
  )
  const list = buildOutgoingComponentRowsFromStages({
    productRows: product.rows,
    itemRows: item.rows,
    giftRowsBySource: unified.giftPlan.giftsBySourceRowNumber,
    giftAssignments: unified.giftPlan.shipments.flatMap(
      (shipment) => shipment.assignments,
    ),
    packingMaterials: workPlan.materialTotals,
  })
  const output = buildInvoiceOutputRows({
    workMatches: workPlan.matchByRowNumber,
    giftRowsBySource: unified.giftPlan.giftsBySourceRowNumber,
    giftAssignments: unified.giftPlan.shipments.flatMap(
      (shipment) => shipment.assignments,
    ),
    productTransformation: product,
    itemTransformation: item,
  })
  return {
    eligibility,
    unified,
    workPlan,
    baseProduct,
    product,
    item,
    list,
    output,
  }
}

export function snapshotInvoiceWork(
  result: InvoiceWorkPipelineResult,
): InvoiceWorkSnapshot {
  const gift = result.unified.giftPlan.shipments
    .flatMap((shipment) =>
      shipment.assignments.map((assignment) => ({
        sourceRowNumber: assignment.sourceRowNumber,
        styleId: assignment.styleId,
        quantity: 1,
      })),
    )
    .sort(
      (left, right) =>
        left.sourceRowNumber - right.sourceRowNumber ||
        left.styleId.localeCompare(right.styleId),
    )
  return {
    product: result.product.rows.map((row) => ({
      rowNumber: row.source.rowNumber,
      status: row.status,
      styleId: row.style?.styleId ?? '',
      name: row.transformedProductName,
      itemName: row.effectiveItemName,
      quantity: row.source.quantity,
    })),
    item: result.item.rows.map((row) => ({
      rowNumber: row.source.rowNumber,
      status: row.status,
      itemName: row.transformedItemName,
      extras: row.extras
        .map((item) => `${item.style.styleId}:${item.role}:${item.quantity}`)
        .sort()
        .join('|'),
    })),
    gift,
    giftSource: result.product.rows
      .filter(
        (row) =>
          row.status === 'gift_mapped' || row.status === 'gift_pending',
      )
      .map((row) => ({
        rowNumber: row.source.rowNumber,
        status: row.status,
        replacements: (row.giftReplacements ?? [])
          .map((item) => `${item.style.styleId}:${item.quantity}`)
          .join('|'),
      })),
    work: [...result.workPlan.matchByRowNumber.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([rowNumber, match]) => ({
        rowNumber,
        instructionId: match.instructionId,
        label: match.labelText,
      })),
    list: result.list.map((row) => ({
      sourceRowNumber: row.sourceRowNumber,
      role: row.role,
      styleNo: row.styleNo,
      quantity: row.quantity,
    })),
    output: result.output.map((row) => ({
      kind: row.kind,
      sourceRowNumber: row.sourceRowNumber,
      productName: row.finalProductName,
      itemName: row.finalItemName,
      quantity: row.quantity,
    })),
  }
}

export function compareInvoiceWorkSnapshots(
  left: InvoiceWorkSnapshot,
  right: InvoiceWorkSnapshot,
): string[] {
  const errors: string[] = []
  function check<T>(label: string, a: T[], b: T[]) {
    if (a.length !== b.length) {
      errors.push(`${label} 길이 ${a.length} ≠ ${b.length}`)
      return
    }
    for (let index = 0; index < a.length; index += 1) {
      const expected = JSON.stringify(a[index])
      const actual = JSON.stringify(b[index])
      if (expected !== actual) {
        errors.push(`${label}[${index}] ${expected} ≠ ${actual}`)
        if (errors.length > 20) return
      }
    }
  }
  check('product', left.product, right.product)
  check('item', left.item, right.item)
  check('gift', left.gift, right.gift)
  check('giftSource', left.giftSource, right.giftSource)
  check('work', left.work, right.work)
  check('list', left.list, right.list)
  check('output', left.output, right.output)
  return errors
}
