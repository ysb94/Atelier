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
  isInvoicePreloadFlowReady,
  isInvoiceWorkFlowReady,
  shouldFinishInvoiceUploadPipeline,
  shouldStartInvoiceItemNameAiCollect,
} from '@/lib/invoice/invoice-step-compute'
import {
  collectItemNameLookupTexts,
  collectOptionMapLookupCombos,
  filterItemNameRulesForTexts,
  filterOptionMapsForCombos,
} from '@/lib/invoice/invoice-item-criteria-keys'
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
  collectProductNameCandidateTexts,
  filterProductNameMapsForLookupTexts,
} from '@/lib/invoice/product-name-patterns'
import {
  buildProductNameLookupIndex,
  catalogFromStyles,
  transformInvoiceProductNames,
} from '@/lib/invoice/product-name-transform'
import {
  runInvoiceItemNameStep,
  runInvoiceProductNameStep,
} from '@/lib/invoice/invoice-step-transform'
import {
  buildProductCompositionOptionIndex,
  findOptionMapsForProductNameMap,
  findOptionMapsForProductNameMapFromIndex,
} from '@/lib/invoice/product-composition'
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
const smallLookupTexts = collectProductNameCandidateTexts(
  smallInput.rows,
  smallInput.productNameTagRoles ?? [],
)
const smallScopedMaps = filterProductNameMapsForLookupTexts(
  smallInput.productNameMaps,
  smallLookupTexts,
)
const smallScoped = transformInvoiceProductNames(
  smallInput.rows,
  smallScopedMaps,
  catalogFromStyles(smallInput.styles),
  smallInput.productNameTagRoles ?? [],
  smallInput.productNameExclusions ?? [],
)
assert(
  smallScopedMaps.length > 0 &&
    smallScopedMaps.length <= smallInput.productNameMaps.length,
  '파일 후보로 원장 범위를 줄인다',
)
assert(
  smallScoped.rows.every(
    (row, index) =>
      row.status === smallFirst.result.product.rows[index]?.status &&
      row.transformedProductName ===
        smallFirst.result.product.rows[index]?.transformedProductName &&
      row.mapId === smallFirst.result.product.rows[index]?.mapId,
  ),
  '파일 범위 원장과 전체 원장의 품목명 변환이 같다',
)
assert(
  smallFirst.result.product.rows.some((row) => row.status === 'unresolved' || row.status === 'missing_style'),
  '소형 미해결 행',
)
assert(
  smallFirst.result.workPlan.matchedRowCount > 0,
  '소형 작업지시 매칭',
)

function assertSameProductStep(
  left: typeof smallFirst.result.product,
  right: typeof smallFirst.result.product,
  label: string,
) {
  assert(left.rows.length === right.rows.length, `${label} 행 수`)
  assert(
    left.rows.every((row, index) => {
      const other = right.rows[index]
      return (
        row.status === other?.status &&
        row.transformedProductName === other.transformedProductName &&
        row.mapId === other.mapId &&
        (row.style?.styleId ?? '') === (other.style?.styleId ?? '')
      )
    }),
    label,
  )
}

function assertSameItemStep(
  left: typeof smallFirst.result.item,
  right: typeof smallFirst.result.item,
  label: string,
) {
  assert(left.rows.length === right.rows.length, `${label} 행 수`)
  assert(
    left.rows.every((row, index) => {
      const other = right.rows[index]
      return (
        row.status === other?.status &&
        row.transformedItemName === other.transformedItemName &&
        JSON.stringify(row.extras) === JSON.stringify(other?.extras)
      )
    }),
    label,
  )
}

const smallWorkerProduct = runInvoiceProductNameStep(
  structuredClone({
    sourceRows: smallInput.rows,
    maps: smallInput.productNameMaps,
    styles: smallInput.styles,
    tagRoles: smallInput.productNameTagRoles ?? [],
    exclusions: smallInput.productNameExclusions ?? [],
    giftSourcePlan: smallFirst.result.unified.giftSourcePlan,
  }),
)
assertSameProductStep(
  smallWorkerProduct.base,
  smallFirst.result.baseProduct,
  '소형 Worker 품목명 기본 변환',
)
assertSameProductStep(
  smallWorkerProduct.product,
  smallFirst.result.product,
  '소형 Worker 품목명 변환',
)
const smallWorkerItem = runInvoiceItemNameStep(
  structuredClone({
    sourceRows: smallInput.rows,
    optionMaps: smallInput.optionMaps ?? [],
    productRows: smallWorkerProduct.product.rows,
    itemNameRules: smallInput.itemNameRules ?? [],
    accessoryRules: smallInput.accessoryRules ?? [],
    styles: smallInput.styles,
  }),
)
assertSameItemStep(smallWorkerItem, smallFirst.result.item, '소형 Worker 내품명 변환')

const largeInput = buildInvoiceWorkFixtureInput(INVOICE_WORK_LARGE_ROW_COUNT)
const indexBuild = measure(() => {
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
  return { catalog, productIndex, itemIndex, workIndex, slots }
})
const { catalog, productIndex, itemIndex, workIndex, slots } = indexBuild.result
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

const largeUiProduct = runInvoiceProductNameStep({
  sourceRows: largeInput.rows,
  maps: [],
  styles: [],
  tagRoles: largeInput.productNameTagRoles ?? [],
  exclusions: largeInput.productNameExclusions ?? [],
  giftSourcePlan: largeIndexed.result.unified.giftSourcePlan,
  productLookupIndex: productIndex,
  productCatalog: catalog,
})
assertSameProductStep(
  largeUiProduct.base,
  largeIndexed.result.baseProduct,
  '대형 UI 색인 품목명 기본 변환',
)
assertSameProductStep(
  largeUiProduct.product,
  largeIndexed.result.product,
  '대형 UI 색인 품목명 변환',
)
const largeUiItem = runInvoiceItemNameStep({
  sourceRows: largeInput.rows,
  optionMaps: [],
  productRows: largeUiProduct.product.rows,
  itemNameRules: [],
  accessoryRules: largeInput.accessoryRules ?? [],
  styles: [],
  itemNameIndex: itemIndex,
})
assertSameItemStep(largeUiItem, largeIndexed.result.item, '대형 UI 색인 내품명 변환')

const optionCombos = collectOptionMapLookupCombos(
  largeInput.rows,
  largeIndexed.result.product.rows,
)
const itemTexts = collectItemNameLookupTexts(
  largeInput.rows,
  largeIndexed.result.product.rows,
)
const scopedOptionMaps = filterOptionMapsForCombos(
  largeInput.optionMaps ?? [],
  optionCombos,
)
const scopedItemRules = filterItemNameRulesForTexts(
  largeInput.itemNameRules ?? [],
  itemTexts,
)
assert(
  scopedOptionMaps.length <= (largeInput.optionMaps ?? []).length,
  '파일 범위 옵션맵은 전체보다 많지 않다',
)
assert(
  scopedItemRules.length <= (largeInput.itemNameRules ?? []).length,
  '파일 범위 내품명 규칙은 전체보다 많지 않다',
)
const scopedItem = runInvoiceItemNameStep({
  sourceRows: largeInput.rows,
  optionMaps: scopedOptionMaps,
  productRows: largeIndexed.result.product.rows,
  itemNameRules: scopedItemRules,
  accessoryRules: largeInput.accessoryRules ?? [],
  styles: largeInput.styles,
})
assertSameItemStep(
  scopedItem,
  largeIndexed.result.item,
  '파일 범위 내품명 기준과 전체 기준의 변환이 같다',
)

const largeWorkerProduct = runInvoiceProductNameStep(
  structuredClone({
    sourceRows: largeInput.rows,
    maps: largeInput.productNameMaps,
    styles: largeInput.styles,
    tagRoles: largeInput.productNameTagRoles ?? [],
    exclusions: largeInput.productNameExclusions ?? [],
    giftSourcePlan: largeIndexed.result.unified.giftSourcePlan,
  }),
)
assertSameProductStep(
  largeWorkerProduct.base,
  largeIndexed.result.baseProduct,
  '대형 Worker 품목명 기본 변환',
)
assertSameProductStep(
  largeWorkerProduct.product,
  largeIndexed.result.product,
  '대형 Worker 품목명 변환',
)
const largeWorkerItem = runInvoiceItemNameStep(
  structuredClone({
    sourceRows: largeInput.rows,
    optionMaps: largeInput.optionMaps ?? [],
    productRows: largeWorkerProduct.product.rows,
    itemNameRules: largeInput.itemNameRules ?? [],
    accessoryRules: largeInput.accessoryRules ?? [],
    styles: largeInput.styles,
  }),
)
assertSameItemStep(largeWorkerItem, largeIndexed.result.item, '대형 Worker 내품명 변환')

const compositionIndex = buildProductCompositionOptionIndex(
  largeInput.optionMaps ?? [],
)
for (const map of largeInput.productNameMaps.slice(0, 80)) {
  const direct = findOptionMapsForProductNameMap(
    largeInput.optionMaps ?? [],
    map,
  ).map((item) => item.id)
  const indexed = findOptionMapsForProductNameMapFromIndex(
    compositionIndex,
    map,
  ).map((item) => item.id)
  assert(
    JSON.stringify(direct) === JSON.stringify(indexed),
    `구성 색인 ${map.id}`,
  )
}

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

assert(
  isInvoicePreloadFlowReady({ backupLookupReady: true, workRowCount: 2 }) &&
    !isInvoiceWorkFlowReady({
      preloadFlowReady: true,
      hasBackedUpMatch: true,
      backedUpExclusionAccepted: false,
    }),
  '파이프라인 계산은 확인 전에 열리고 다음 단계 이동은 막힌다',
)
assert(
  shouldFinishInvoiceUploadPipeline({
    headerReady: true,
    backupLookupReady: true,
    workRowCount: 2,
    exclusionSigAligned: true,
    stagesSettled: true,
    laterStagesSettled: true,
    productAiSettled: true,
  }),
  '업로드 파이프라인은 내품명 AI 완료를 기다리지 않는다',
)
assert(
  !shouldStartInvoiceItemNameAiCollect({ userRequested: false }),
  '내품명 AI는 추천 모으기를 누르기 전에는 시작하지 않는다',
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
      rowCount: INVOICE_WORK_LARGE_ROW_COUNT,
      smallMs: Math.round(smallFirst.ms),
      smallRepeatMs: Math.round(smallSecond.ms),
      indexBuildMs: Math.round(indexBuild.ms),
      largeIndexedMs: Math.round(largeIndexed.ms),
      largePlainMs: Math.round(largePlain.ms),
      smallParseMs: Math.round(smallParse.ms),
      largeParseMs: Math.round(largeParse.ms),
      cloneMs: Math.round(cloneCost.ms),
      scopedOptionMaps: scopedOptionMaps.length,
      scopedItemRules: scopedItemRules.length,
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
