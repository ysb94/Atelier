/**
 * 송장 전체 파이프라인 결과 동등성·소형/대형 성능 기준선.
 * 실행: npm run verify:invoice-work-pipeline
 */
import {
  compareInvoiceWorkSnapshots,
  runInvoiceWorkPipeline,
  snapshotInvoiceWork,
} from '@/lib/invoice/invoice-work-pipeline'
import {
  INVOICE_WORK_LARGE_ROW_COUNT,
  INVOICE_WORK_SMALL_ROW_COUNT,
  buildInvoiceWorkFixtureInput,
} from '@/lib/invoice/invoice-work-fixtures'
import { inspectSabangnetSheets } from '@/lib/invoice/sabangnet'
import { SABANGNET_COLUMNS } from '@/lib/invoice/sabangnet'
import {
  buildItemNameTransformIndex,
} from '@/lib/invoice/item-name-transform'
import {
  buildProductNameLookupIndex,
  catalogFromStyles,
} from '@/lib/invoice/product-name-transform'
import { collectGiftSourceSlots } from '@/lib/invoice/gift-source-transform'
import { buildWorkInstructionIndex } from '@/lib/invoice/work-instruction-transform'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function measure<T>(fn: () => T): { result: T; ms: number } {
  const start = nowMs()
  const result = fn()
  return { result, ms: nowMs() - start }
}

function buildSyntheticSheets(rowCount: number) {
  const header = SABANGNET_COLUMNS.map((column) => column.label)
  const rows = [header]
  const input = buildInvoiceWorkFixtureInput(rowCount)
  for (const source of input.rows) {
    rows.push([
      source.productName,
      source.itemName,
      source.quantity,
      source.recipientName,
      source.recipientPhone,
      source.recipientOtherPhone,
      source.shippingType,
      source.recipientAddress,
      source.shippingMessage,
      source.customerOrderNo,
      source.mallName,
      source.orderedAt,
      source.ownProductCode,
    ])
  }
  return [{ name: '주문', rows }]
}

const smallInput = buildInvoiceWorkFixtureInput(INVOICE_WORK_SMALL_ROW_COUNT)
const smallFirst = measure(() => runInvoiceWorkPipeline(smallInput))
const smallSecond = measure(() => runInvoiceWorkPipeline(smallInput))
const smallSnapshot = snapshotInvoiceWork(smallFirst.result)
const smallErrors = compareInvoiceWorkSnapshots(
  smallSnapshot,
  snapshotInvoiceWork(smallSecond.result),
)
assert(smallErrors.length === 0, smallErrors.join('\n'))
assert(
  smallFirst.result.product.rows.length === INVOICE_WORK_SMALL_ROW_COUNT,
  '소형 품목명 행 수',
)
assert(
  smallFirst.result.output.length >= INVOICE_WORK_SMALL_ROW_COUNT,
  '소형 최종 행 수',
)
assert(
  smallFirst.result.product.rows.some((row) => row.status === 'mapped'),
  '소형 매핑 행',
)
assert(
  smallFirst.result.product.rows.some((row) => row.status === 'unresolved' || row.status === 'missing_style'),
  '소형 미해결 행',
)
assert(
  smallFirst.result.workPlan.matchedRowCount > 0,
  '소형 작업지시 매칭',
)

const largeInput = buildInvoiceWorkFixtureInput(INVOICE_WORK_LARGE_ROW_COUNT)
const catalog = catalogFromStyles(largeInput.styles)
const productIndex = buildProductNameLookupIndex(
  largeInput.productNameMaps,
  largeInput.productNameTagRoles ?? [],
)
const itemIndex = buildItemNameTransformIndex(
  largeInput.optionMaps ?? [],
  largeInput.itemNameRules ?? [],
  largeInput.styles,
)
const workIndex = buildWorkInstructionIndex(largeInput.workInstructions ?? [])
const slots = collectGiftSourceSlots(
  largeInput.rows,
  largeInput.productNameTagRoles ?? [],
)
const largeIndexed = measure(() =>
  runInvoiceWorkPipeline({
    ...largeInput,
    productCatalog: catalog,
    productLookupIndex: productIndex,
    itemNameIndex: itemIndex,
    workInstructionIndex: workIndex,
    giftSourceSlots: slots,
  }),
)
const largePlain = measure(() => runInvoiceWorkPipeline(largeInput))
const largeErrors = compareInvoiceWorkSnapshots(
  snapshotInvoiceWork(largeIndexed.result),
  snapshotInvoiceWork(largePlain.result),
)
assert(largeErrors.length === 0, largeErrors.join('\n'))
assert(
  largeIndexed.result.product.rows.length === INVOICE_WORK_LARGE_ROW_COUNT,
  '대형 품목명 행 수',
)
assert(
  largeIndexed.result.output.length >= INVOICE_WORK_LARGE_ROW_COUNT,
  '대형 최종 행 수',
)

const smallParse = measure(() =>
  inspectSabangnetSheets(buildSyntheticSheets(INVOICE_WORK_SMALL_ROW_COUNT)),
)
const largeParse = measure(() =>
  inspectSabangnetSheets(buildSyntheticSheets(INVOICE_WORK_LARGE_ROW_COUNT)),
)
assert(
  smallParse.result.rowCount === INVOICE_WORK_SMALL_ROW_COUNT,
  '소형 파싱 행 수',
)
assert(
  largeParse.result.rowCount === INVOICE_WORK_LARGE_ROW_COUNT,
  '대형 파싱 행 수',
)

const cloneCost = measure(() =>
  structuredClone({
    rows: largeInput.rows,
    maps: largeInput.productNameMaps,
    styles: largeInput.styles,
  }),
)
const workerWouldHelp =
  cloneCost.ms + 8 < largeIndexed.ms * 0.15
    ? false
    : largeIndexed.ms > 250 && cloneCost.ms < largeIndexed.ms * 0.35

console.log(
  JSON.stringify(
    {
      smallMs: Math.round(smallFirst.ms),
      smallRepeatMs: Math.round(smallSecond.ms),
      largeIndexedMs: Math.round(largeIndexed.ms),
      largePlainMs: Math.round(largePlain.ms),
      smallParseMs: Math.round(smallParse.ms),
      largeParseMs: Math.round(largeParse.ms),
      cloneMs: Math.round(cloneCost.ms),
      recommendComputeWorker: workerWouldHelp,
      recommendParseWorker: largeParse.ms > 80,
    },
    null,
    2,
  ),
)

export const INVOICE_COMPUTE_WORKER_MIN_ROWS = workerWouldHelp
  ? 8_000
  : Number.POSITIVE_INFINITY
export const INVOICE_PARSE_WORKER_MIN_BYTES = largeParse.ms > 80 ? 80_000 : Number.POSITIVE_INFINITY
