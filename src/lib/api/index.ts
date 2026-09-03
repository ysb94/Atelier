import type {
  AiFeatureRoute,
  AiProductCandidate,
  AiProductRecommendation,
  AiProvider,
  AiRecommendationPolicy,
  AiUsageSummary,
  Brand,
  BrandInput,
  BrandField,
  BrandFieldInput,
  BrandFieldOptionInput,
  BarcodeField,
  BarcodeFieldInput,
  CodeUsageAssignment,
  CodeUsageAssignmentInput,
  CodeUsageStatus,
  CodeUsageTarget,
  CodeUsageTargetAlias,
  CodeUsageTargetFolder,
  CodeUsageTargetInput,
  InvoiceNameRule,
  InvoiceItemNameRule,
  InvoiceAccessoryRule,
  InvoiceOptionMap,
  InvoicePackingSizeMap,
  InvoicePackingSizeSourceValue,
  InvoicePickingRoutePreset,
  AiAccessoryRecommendation,
  AiItemNameRecommendation,
  InvoiceProductNameMap,
  InvoiceProductNameExclusion,
  InvoicePreorderHold,
  InvoicePreorderHoldStatus,
  InvoiceDiscontinuedStyle,
  InvoiceProductNameTagRoleEntry,
  InvoiceGiftAllocation,
  InvoiceGiftSourceAllocation,
  InvoiceGiftSourceMap,
  InvoiceGiftRequest,
  InvoicePrefixRequest,
  InvoiceWorkInstruction,
  InvoiceWorkRun,
  ProductCode,
  ProductCodeInput,
  ProductCodeKind,
  ProductDraft,
  ProductDraftInput,
  Season,
  SeasonInput,
  Style,
  StyleInput,
  WarehouseInventorySet,
  WarehouseStockMovement,
  WarehouseStockPosition,
  WarehouseZone,
} from '@/lib/types'
import * as aiCandidateStore from '@/lib/supabase/ai-candidates'
import * as aiGatewayStore from '@/lib/supabase/ai-gateway'
import * as aiSettingsStore from '@/lib/supabase/ai-settings'
import * as brandStore from '@/lib/supabase/brands'
import { getMyProfile } from '@/lib/supabase/profiles'
import * as brandFieldStore from '@/lib/supabase/brand-fields'
import * as barcodeFieldStore from '@/lib/supabase/barcode-fields'
import * as codeUsageTargetStore from '@/lib/supabase/code-usage-targets'
import * as codeUsageTargetFolderStore from '@/lib/supabase/code-usage-target-folders'
import type {
  BulkCodeUsageTargetResult,
  BulkCodeUsageTargetRow,
} from '@/lib/supabase/code-usage-targets'
import * as codeUsageAssignmentStore from '@/lib/supabase/code-usage-assignments'
import * as invoiceGiftAllocationStore from '@/lib/supabase/invoice-gift-allocations'
import * as invoiceGiftSourceMapStore from '@/lib/supabase/invoice-gift-source-maps'
import * as invoiceNameRuleStore from '@/lib/supabase/invoice-name-rules'
import * as invoiceItemNameRuleStore from '@/lib/supabase/invoice-item-name-rules'
import * as invoiceAccessoryRuleStore from '@/lib/supabase/invoice-accessory-rules'
import * as invoiceOptionMapStore from '@/lib/supabase/invoice-option-maps'
import type { OptionMapLookupCombo } from '@/lib/invoice/invoice-item-criteria-keys'
import * as invoicePackingSizeMapStore from '@/lib/supabase/invoice-packing-size-maps'
import * as invoicePickingRoutePresetStore from '@/lib/supabase/invoice-picking-route-presets'
import * as invoiceProductNameMapStore from '@/lib/supabase/invoice-product-name-maps'
import * as invoiceProductNameExclusionStore from '@/lib/supabase/invoice-product-name-exclusions'
import * as invoicePreorderHoldStore from '@/lib/supabase/invoice-preorder-holds'
import * as invoiceDiscontinuedStyleStore from '@/lib/supabase/invoice-discontinued-styles'
import * as invoiceProductNameTagRoleStore from '@/lib/supabase/invoice-product-name-tag-roles'
import * as invoicePrefixRequestStore from '@/lib/supabase/invoice-prefix-requests'
import * as invoiceWorkHistoryStore from '@/lib/supabase/invoice-work-history'
import * as invoiceWorkInstructionStore from '@/lib/supabase/invoice-work-instructions'
import * as productCodeStore from '@/lib/supabase/product-codes'
import * as partnerBarcodeFieldStore from '@/lib/supabase/partner-barcode-fields'
import * as barcodePartnerDisplaySettingStore from '@/lib/supabase/barcode-partner-display-settings'
import * as bulkOutboundStore from '@/lib/supabase/bulk-outbound'
import * as outboundShipmentStore from '@/lib/supabase/outbound-shipments'
import * as productDraftStore from '@/lib/supabase/product-drafts'
import * as seasonStore from '@/lib/supabase/seasons'
import * as styleStore from '@/lib/supabase/styles'
import * as warehouseStockStore from '@/lib/supabase/warehouse-stock'
import type { PreparedWarehouseImportRow } from '@/lib/warehouse/stock'

const delay = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms))

export { AiCandidateStoreError } from '@/lib/supabase/ai-candidates'
export { AiGatewayError } from '@/lib/supabase/ai-gateway'
export { AiSettingsStoreError } from '@/lib/supabase/ai-settings'
export { BrandStoreError } from '@/lib/supabase/brands'
export { BrandFieldStoreError } from '@/lib/supabase/brand-fields'
export { BarcodeFieldStoreError } from '@/lib/supabase/barcode-fields'
export { CodeUsageTargetStoreError } from '@/lib/supabase/code-usage-targets'
export type {
  BulkCodeUsageTargetResult,
  BulkCodeUsageTargetRow,
  SaveCodeUsageTargetInput,
} from '@/lib/supabase/code-usage-targets'
export { CodeUsageAssignmentStoreError } from '@/lib/supabase/code-usage-assignments'
export { InvoiceNameRuleStoreError } from '@/lib/supabase/invoice-name-rules'
export type {
  InvoiceCodeRuleInput,
  InvoiceNameRuleUpdateInput,
} from '@/lib/supabase/invoice-name-rules'
export { InvoiceItemNameRuleStoreError } from '@/lib/supabase/invoice-item-name-rules'
export type {
  InvoiceItemNameRuleBulkFailure,
  InvoiceItemNameRuleBulkResult,
  InvoiceItemNameRuleComponentInput,
  InvoiceItemNameRuleInput,
} from '@/lib/supabase/invoice-item-name-rules'
export { InvoiceAccessoryRuleStoreError } from '@/lib/supabase/invoice-accessory-rules'
export type { InvoiceAccessoryRuleInput } from '@/lib/supabase/invoice-accessory-rules'
export { InvoiceOptionMapStoreError } from '@/lib/supabase/invoice-option-maps'
export { WarehouseStockStoreError } from '@/lib/supabase/warehouse-stock'
export type {
  WarehouseAdjustInput,
  WarehouseMoveInput,
  WarehouseReceiveInput,
} from '@/lib/supabase/warehouse-stock'
export { InvoicePackingSizeMapStoreError } from '@/lib/supabase/invoice-packing-size-maps'
export type { InvoicePackingSizeMapInput } from '@/lib/supabase/invoice-packing-size-maps'
export { InvoicePickingRoutePresetStoreError } from '@/lib/supabase/invoice-picking-route-presets'
export type { InvoicePickingRoutePresetInput } from '@/lib/supabase/invoice-picking-route-presets'
export type {
  InvoiceOptionComponentInput,
  InvoiceOptionMapInput,
} from '@/lib/supabase/invoice-option-maps'
export { InvoiceProductNameMapStoreError } from '@/lib/supabase/invoice-product-name-maps'
export type {
  InvoiceProductNameLookupHit,
  InvoiceProductNameMapBulkResult,
  InvoiceProductNameMapInput,
} from '@/lib/supabase/invoice-product-name-maps'
export { InvoiceProductNameExclusionStoreError } from '@/lib/supabase/invoice-product-name-exclusions'
export type { InvoiceProductNameExclusionInput } from '@/lib/supabase/invoice-product-name-exclusions'
export { InvoicePreorderHoldStoreError } from '@/lib/supabase/invoice-preorder-holds'
export type {
  InvoicePreorderHoldInput,
  InvoicePreorderHoldUpdateInput,
  InvoicePreorderHoldExtendInput,
  InvoicePreorderHoldEndInput,
} from '@/lib/supabase/invoice-preorder-holds'
export { InvoiceDiscontinuedStyleStoreError } from '@/lib/supabase/invoice-discontinued-styles'
export type { InvoiceDiscontinuedStyleInput } from '@/lib/supabase/invoice-discontinued-styles'
export { InvoiceProductNameTagRoleStoreError } from '@/lib/supabase/invoice-product-name-tag-roles'
export type { InvoiceProductNameTagRoleInput } from '@/lib/supabase/invoice-product-name-tag-roles'
export { InvoicePrefixRequestStoreError } from '@/lib/supabase/invoice-prefix-requests'
export type {
  InvoiceGiftQuotaInput,
  InvoicePrefixItemInput,
  InvoicePrefixRequestInput,
} from '@/lib/supabase/invoice-prefix-requests'
export { InvoiceGiftSourceMapStoreError } from '@/lib/supabase/invoice-gift-source-maps'
export type {
  InvoiceGiftSourceAssignRequest,
  InvoiceGiftSourceAssignResult,
  InvoiceGiftSourceConfirmRequest,
  InvoiceGiftSourceMapInput,
} from '@/lib/supabase/invoice-gift-source-maps'
export { InvoiceGiftAllocationStoreError } from '@/lib/supabase/invoice-gift-allocations'
export type {
  ConfirmGiftAllocationsResult,
  GiftAllocationCandidateInput,
} from '@/lib/supabase/invoice-gift-allocations'
export { InvoiceWorkHistoryStoreError } from '@/lib/supabase/invoice-work-history'
export type { RecordInvoiceWorkCompletionInput } from '@/lib/supabase/invoice-work-history'
export { InvoiceWorkInstructionStoreError } from '@/lib/supabase/invoice-work-instructions'
export type {
  InvoiceWorkInstructionInput,
  InvoiceWorkInstructionItemInput,
} from '@/lib/supabase/invoice-work-instructions'
export { ProductCodeStoreError } from '@/lib/supabase/product-codes'
export { PartnerBarcodeFieldStoreError } from '@/lib/supabase/partner-barcode-fields'
export type { PartnerBarcodeField } from '@/lib/supabase/partner-barcode-fields'
export { BarcodePartnerDisplaySettingStoreError } from '@/lib/supabase/barcode-partner-display-settings'
export type {
  BarcodePartnerDisplayScope,
  BarcodePartnerDisplaySetting,
} from '@/lib/supabase/barcode-partner-display-settings'
export { BulkOutboundStoreError } from '@/lib/supabase/bulk-outbound'
export type {
  BulkOutboundBarcodeSource,
  BulkOutboundJob,
  BulkOutboundJobFile,
  BulkOutboundJobInput,
  BulkOutboundJobLine,
  BulkOutboundJobStatus,
  BulkOutboundPartnerConfig,
  BulkOutboundPartnerWorkStatus,
  BulkOutboundTemplateField,
} from '@/lib/supabase/bulk-outbound'
export { canSetBulkOutboundPartnerWorkStatus } from '@/lib/supabase/bulk-outbound'
export { OutboundShipmentStoreError } from '@/lib/supabase/outbound-shipments'
export {
  ProductDraftStoreError,
  emptyDraftInput,
  newColorRow,
  newOptionRow,
  MAX_DRAFT_COLORS,
} from '@/lib/supabase/product-drafts'
export {
  SeasonStoreError,
  UNASSIGNED_SEASON_CODE,
  UNASSIGNED_SEASON_NAME,
} from '@/lib/supabase/seasons'
export { StyleStoreError } from '@/lib/supabase/styles'
export type { StyleFilter } from '@/lib/supabase/styles'

/**
 * 브랜드 API. 원본은 Supabase다.
 * SKU 수는 styles 테이블 COUNT로 붙인다.
 */
async function withStyleCounts(
  brands: Omit<Brand, 'styleCount'>[],
): Promise<Brand[]> {
  if (brands.length === 0) return []
  const counts = await styleStore.countStylesByBrand(brands.map((b) => b.id))
  return brands.map((brand) => ({
    ...brand,
    styleCount: counts[brand.id] ?? 0,
  }))
}

/** 관리자가 아니면 담당 브랜드만 보여 준다. RLS는 로그인 사용자 전체 조회를 허용한다. */
async function filterAccessibleBrands(
  brands: Omit<Brand, 'styleCount'>[],
): Promise<Omit<Brand, 'styleCount'>[]> {
  const profile = await getMyProfile()
  if (!profile || profile.status !== 'active') return []
  if (profile.isAdmin) return brands
  const allowed = new Set(profile.memberships.map((m) => m.brandId))
  return brands.filter((brand) => allowed.has(brand.id))
}

export async function getBrands(): Promise<Brand[]> {
  const brands = await filterAccessibleBrands(await brandStore.listBrands())
  return withStyleCounts(brands)
}

export async function getBrandBySlug(slug: string): Promise<Brand | undefined> {
  const brand = await brandStore.getBrandBySlug(slug)
  if (!brand) return undefined
  const [accessible] = await filterAccessibleBrands([brand])
  if (!accessible) return undefined
  const [withCount] = await withStyleCounts([accessible])
  return withCount
}

export async function createBrand(input: BrandInput): Promise<Brand> {
  const brand = await brandStore.createBrand(input)
  return { ...brand, styleCount: 0 }
}

export async function updateBrand(
  id: string,
  input: BrandInput,
): Promise<Brand> {
  const brand = await brandStore.updateBrand(id, input)
  const [withCount] = await withStyleCounts([brand])
  return withCount
}

export async function deleteBrand(id: string): Promise<void> {
  return brandStore.deleteBrand(id)
}

export async function getBrandFields(brandId: string): Promise<BrandField[]> {
  await delay()
  return brandFieldStore.listBrandFields(brandId)
}

export async function createBrandField(
  brandId: string,
  input: BrandFieldInput,
): Promise<BrandField> {
  await delay()
  return brandFieldStore.createBrandField(brandId, input)
}

export async function updateBrandField(
  id: string,
  patch: Partial<Pick<BrandField, 'label' | 'required' | 'type' | 'owner'>>,
): Promise<BrandField> {
  await delay()
  return brandFieldStore.updateBrandField(id, patch)
}

export async function deleteBrandField(id: string): Promise<void> {
  await delay()
  return brandFieldStore.deleteBrandField(id)
}

export async function saveBrandFieldOptions(
  brandId: string,
  fieldId: string,
  options: BrandFieldOptionInput[],
): Promise<BrandField> {
  await delay()
  return brandFieldStore.saveBrandFieldOptions(brandId, fieldId, options)
}

export async function getBarcodeFields(
  brandId: string,
): Promise<BarcodeField[]> {
  await delay()
  return barcodeFieldStore.listBarcodeFields(brandId)
}

export async function createBarcodeField(
  brandId: string,
  input: BarcodeFieldInput,
): Promise<BarcodeField> {
  await delay()
  return barcodeFieldStore.createBarcodeField(brandId, input)
}

export async function updateBarcodeField(
  id: string,
  input: BarcodeFieldInput,
): Promise<BarcodeField> {
  await delay()
  return barcodeFieldStore.updateBarcodeField(id, input)
}

export async function deleteBarcodeField(id: string): Promise<void> {
  await delay()
  return barcodeFieldStore.deleteBarcodeField(id)
}

export async function moveBarcodeField(
  id: string,
  direction: 'up' | 'down',
): Promise<void> {
  await delay()
  return barcodeFieldStore.moveBarcodeField(id, direction)
}

/** 송장 변환과 기준정보 화면이 같은 이름변경 원본을 사용한다. */
export async function getInvoiceNameRules(
  brandId: string,
  activeOnly = false,
): Promise<InvoiceNameRule[]> {
  return invoiceNameRuleStore.listInvoiceNameRules(brandId, { activeOnly })
}

export async function saveInvoiceCodeRule(
  brandId: string,
  input: invoiceNameRuleStore.InvoiceCodeRuleInput,
): Promise<InvoiceNameRule> {
  await delay()
  return invoiceNameRuleStore.saveInvoiceCodeRule(brandId, input)
}

export async function updateInvoiceNameRule(
  id: string,
  input: invoiceNameRuleStore.InvoiceNameRuleUpdateInput,
): Promise<InvoiceNameRule> {
  await delay()
  return invoiceNameRuleStore.updateInvoiceNameRule(id, input)
}

export async function getInvoiceItemNameRules(
  brandId: string,
  activeOnly = false,
): Promise<InvoiceItemNameRule[]> {
  return invoiceItemNameRuleStore.listInvoiceItemNameRules(brandId, {
    activeOnly,
  })
}

export async function getInvoiceItemNameRulesForItemNames(
  brandId: string,
  itemNames: string[],
): Promise<InvoiceItemNameRule[]> {
  return invoiceItemNameRuleStore.listInvoiceItemNameRulesForItemNames(
    brandId,
    itemNames,
  )
}

export async function saveInvoiceItemNameRule(
  brandId: string,
  input: invoiceItemNameRuleStore.InvoiceItemNameRuleInput,
  ruleId?: string,
): Promise<InvoiceItemNameRule> {
  await delay()
  return invoiceItemNameRuleStore.saveInvoiceItemNameRule(
    brandId,
    input,
    ruleId,
  )
}

export async function saveInvoiceItemNameRules(
  brandId: string,
  items: Array<{
    input: invoiceItemNameRuleStore.InvoiceItemNameRuleInput
    ruleId?: string
  }>,
): Promise<invoiceItemNameRuleStore.InvoiceItemNameRuleBulkResult> {
  await delay()
  return invoiceItemNameRuleStore.saveInvoiceItemNameRules(brandId, items)
}

export async function setInvoiceItemNameRuleActive(
  id: string,
  isActive: boolean,
): Promise<InvoiceItemNameRule> {
  await delay()
  return invoiceItemNameRuleStore.setInvoiceItemNameRuleActive(id, isActive)
}

export async function getInvoiceAccessoryRules(
  brandId: string,
  activeOnly = false,
): Promise<InvoiceAccessoryRule[]> {
  return invoiceAccessoryRuleStore.listInvoiceAccessoryRules(brandId, {
    activeOnly,
  })
}

export async function saveInvoiceAccessoryRule(
  brandId: string,
  input: invoiceAccessoryRuleStore.InvoiceAccessoryRuleInput,
  ruleId?: string,
): Promise<InvoiceAccessoryRule> {
  await delay()
  return invoiceAccessoryRuleStore.saveInvoiceAccessoryRule(
    brandId,
    input,
    ruleId,
  )
}

export async function saveInvoiceAccessoryRules(
  brandId: string,
  items: invoiceAccessoryRuleStore.InvoiceAccessoryRuleInput[],
) {
  await delay()
  return invoiceAccessoryRuleStore.saveInvoiceAccessoryRules(brandId, items)
}

export async function setInvoiceAccessoryRuleActive(
  id: string,
  isActive: boolean,
): Promise<InvoiceAccessoryRule> {
  await delay()
  return invoiceAccessoryRuleStore.setInvoiceAccessoryRuleActive(id, isActive)
}

export async function deleteInvoiceAccessoryRule(id: string): Promise<void> {
  await delay()
  return invoiceAccessoryRuleStore.deleteInvoiceAccessoryRule(id)
}

export async function getInvoicePackingSizeMaps(
  brandId: string,
  fieldId: string,
): Promise<InvoicePackingSizeMap[]> {
  await delay()
  return invoicePackingSizeMapStore.listInvoicePackingSizeMaps(
    brandId,
    fieldId,
  )
}

export async function getInvoicePackingSizeSourceValues(
  brandId: string,
  fieldId: string,
): Promise<InvoicePackingSizeSourceValue[]> {
  await delay()
  return invoicePackingSizeMapStore.listInvoicePackingSizeSourceValues(
    brandId,
    fieldId,
  )
}

export async function saveInvoicePackingSizeMaps(
  brandId: string,
  fieldId: string,
  mappings: invoicePackingSizeMapStore.InvoicePackingSizeMapInput[],
): Promise<InvoicePackingSizeMap[]> {
  await delay()
  return invoicePackingSizeMapStore.saveInvoicePackingSizeMaps(
    brandId,
    fieldId,
    mappings,
  )
}

export async function getInvoicePickingRoutePresets(
  brandId: string,
  warehouseZone: WarehouseZone,
): Promise<InvoicePickingRoutePreset[]> {
  await delay()
  return invoicePickingRoutePresetStore.listInvoicePickingRoutePresets(
    brandId,
    warehouseZone,
  )
}

export async function createInvoicePickingRoutePreset(
  brandId: string,
  warehouseZone: WarehouseZone,
  input: invoicePickingRoutePresetStore.InvoicePickingRoutePresetInput,
): Promise<InvoicePickingRoutePreset> {
  await delay()
  return invoicePickingRoutePresetStore.createInvoicePickingRoutePreset(
    brandId,
    warehouseZone,
    input,
  )
}

export async function updateInvoicePickingRoutePreset(
  id: string,
  input: invoicePickingRoutePresetStore.InvoicePickingRoutePresetInput,
): Promise<InvoicePickingRoutePreset> {
  await delay()
  return invoicePickingRoutePresetStore.updateInvoicePickingRoutePreset(
    id,
    input,
  )
}

export async function deleteInvoicePickingRoutePreset(
  id: string,
): Promise<void> {
  await delay()
  return invoicePickingRoutePresetStore.deleteInvoicePickingRoutePreset(id)
}

export async function getWarehouseInventorySets(brandId: string) {
  await delay()
  return warehouseStockStore.listWarehouseInventorySets(brandId)
}

export async function getActiveWarehouseInventorySet(brandId: string) {
  await delay()
  return warehouseStockStore.getActiveWarehouseInventorySet(brandId)
}

export async function getWarehouseStockPositions(
  brandId: string,
  setId: string,
  zone?: WarehouseZone,
): Promise<WarehouseStockPosition[]> {
  await delay()
  return warehouseStockStore.listWarehouseStockPositions(brandId, setId, zone)
}

export async function getWarehouseStockMovements(
  brandId: string,
  setId: string,
  positionId?: string,
): Promise<WarehouseStockMovement[]> {
  await delay()
  return warehouseStockStore.listWarehouseStockMovements(
    brandId,
    setId,
    positionId,
  )
}

export async function importWarehouseInventorySet(
  brandId: string,
  sourceFileName: string,
  rows: PreparedWarehouseImportRow[],
  zone: WarehouseZone,
): Promise<WarehouseInventorySet> {
  await delay()
  return warehouseStockStore.importWarehouseInventorySet(
    brandId,
    sourceFileName,
    rows,
    zone,
  )
}

export async function restoreWarehouseInventorySet(
  brandId: string,
  setId: string,
): Promise<WarehouseInventorySet> {
  await delay()
  return warehouseStockStore.restoreWarehouseInventorySet(brandId, setId)
}

export async function receiveWarehouseStock(
  brandId: string,
  input: warehouseStockStore.WarehouseReceiveInput,
) {
  await delay()
  return warehouseStockStore.receiveWarehouseStock(brandId, input)
}

export async function moveWarehouseStock(
  brandId: string,
  input: warehouseStockStore.WarehouseMoveInput,
  action: 'move' | 'replenish' = 'move',
) {
  await delay()
  return warehouseStockStore.moveWarehouseStock(brandId, input, action)
}

export async function depleteWarehouseStock(
  brandId: string,
  positionId: string,
  reason?: string,
) {
  await delay()
  return warehouseStockStore.depleteWarehouseStock(brandId, positionId, reason)
}

export async function adjustWarehouseStock(
  brandId: string,
  input: warehouseStockStore.WarehouseAdjustInput,
) {
  await delay()
  return warehouseStockStore.adjustWarehouseStock(brandId, input)
}

export async function openWarehouseStock(
  brandId: string,
  positionId: string,
  boxCount: number,
  reason?: string,
) {
  await delay()
  return warehouseStockStore.openWarehouseStock(
    brandId,
    positionId,
    boxCount,
    reason,
  )
}

export async function getInvoiceOptionMaps(
  brandId: string,
  activeOnly = false,
): Promise<InvoiceOptionMap[]> {
  return invoiceOptionMapStore.listInvoiceOptionMaps(brandId, { activeOnly })
}

export async function getInvoiceOptionMapsForCombos(
  brandId: string,
  combos: OptionMapLookupCombo[],
): Promise<InvoiceOptionMap[]> {
  return invoiceOptionMapStore.listInvoiceOptionMapsForCombos(brandId, combos)
}

export async function saveInvoiceOptionMap(
  brandId: string,
  input: invoiceOptionMapStore.InvoiceOptionMapInput,
  mapId?: string,
): Promise<InvoiceOptionMap> {
  await delay()
  return invoiceOptionMapStore.saveInvoiceOptionMap(brandId, input, mapId)
}

export async function setInvoiceOptionMapActive(
  id: string,
  isActive: boolean,
): Promise<void> {
  await delay()
  return invoiceOptionMapStore.setInvoiceOptionMapActive(id, isActive)
}

export async function deleteInvoiceOptionMap(id: string): Promise<void> {
  await delay()
  return invoiceOptionMapStore.deleteInvoiceOptionMap(id)
}

export async function applyBulkInvoiceOptionMaps(
  brandId: string,
  rows: invoiceOptionMapStore.InvoiceOptionMapInput[],
): Promise<{
  saved: number
  failures: { index: number; message: string }[]
}> {
  await delay(200)
  return invoiceOptionMapStore.applyBulkInvoiceOptionMaps(brandId, rows)
}

export async function getInvoiceProductNameMaps(
  brandId: string,
  activeOnly = false,
): Promise<InvoiceProductNameMap[]> {
  return invoiceProductNameMapStore.listInvoiceProductNameMaps(brandId, {
    activeOnly,
  })
}

export async function getInvoiceProductNameMapsForLookupKeys(
  brandId: string,
  texts: string[],
): Promise<InvoiceProductNameMap[]> {
  return invoiceProductNameMapStore.listInvoiceProductNameMapsForLookupKeys(
    brandId,
    texts,
  )
}

export async function searchInvoiceProductNameMapsByLookupKey(
  brandId: string,
  search: string,
  limit = 20,
) {
  return invoiceProductNameMapStore.searchInvoiceProductNameMapsByLookupKey(
    brandId,
    search,
    limit,
  )
}

export async function saveInvoiceProductNameMap(
  brandId: string,
  input: invoiceProductNameMapStore.InvoiceProductNameMapInput,
  mapId?: string,
): Promise<InvoiceProductNameMap> {
  await delay()
  return invoiceProductNameMapStore.saveInvoiceProductNameMap(
    brandId,
    input,
    mapId,
  )
}

export async function setInvoiceProductNameMapActive(
  id: string,
  isActive: boolean,
): Promise<void> {
  await delay()
  return invoiceProductNameMapStore.setInvoiceProductNameMapActive(id, isActive)
}

export async function deleteInvoiceProductNameMap(id: string): Promise<void> {
  await delay()
  return invoiceProductNameMapStore.deleteInvoiceProductNameMap(id)
}

export async function setInvoiceProductNameMapsStyle(
  brandId: string,
  ids: string[],
  styleId: string,
) {
  await delay()
  return invoiceProductNameMapStore.setInvoiceProductNameMapsStyle(
    brandId,
    ids,
    styleId,
  )
}

export async function setInvoiceProductNameMapsActive(
  brandId: string,
  ids: string[],
  isActive: boolean,
) {
  await delay()
  return invoiceProductNameMapStore.setInvoiceProductNameMapsActive(
    brandId,
    ids,
    isActive,
  )
}

export async function deleteInvoiceProductNameMaps(
  brandId: string,
  ids: string[],
) {
  await delay()
  return invoiceProductNameMapStore.deleteInvoiceProductNameMaps(brandId, ids)
}

export async function undoInvoiceProductNameMap(
  brandId: string,
  input: {
    mapId: string
    expectedUpdatedAt: string
    previous: InvoiceProductNameMap | null
  },
): Promise<'deleted' | 'restored'> {
  await delay()
  return invoiceProductNameMapStore.undoInvoiceProductNameMap(brandId, input)
}

export async function getInvoiceProductNameExclusions(
  brandId: string,
  activeOnly = false,
): Promise<InvoiceProductNameExclusion[]> {
  return invoiceProductNameExclusionStore.listInvoiceProductNameExclusions(
    brandId,
    { activeOnly },
  )
}

export async function saveInvoiceProductNameExclusion(
  brandId: string,
  input: invoiceProductNameExclusionStore.InvoiceProductNameExclusionInput,
  exclusionId?: string,
): Promise<InvoiceProductNameExclusion> {
  await delay()
  return invoiceProductNameExclusionStore.saveInvoiceProductNameExclusion(
    brandId,
    input,
    exclusionId,
  )
}

export async function setInvoiceProductNameExclusionActive(
  id: string,
  isActive: boolean,
): Promise<void> {
  await delay()
  return invoiceProductNameExclusionStore.setInvoiceProductNameExclusionActive(
    id,
    isActive,
  )
}

export async function deleteInvoiceProductNameExclusion(
  id: string,
): Promise<void> {
  await delay()
  return invoiceProductNameExclusionStore.deleteInvoiceProductNameExclusion(id)
}

export async function getInvoicePreorderHolds(
  brandId: string,
  status: InvoicePreorderHoldStatus | 'all' = 'all',
): Promise<InvoicePreorderHold[]> {
  return invoicePreorderHoldStore.listInvoicePreorderHolds(brandId, { status })
}

export async function createInvoicePreorderHold(
  brandId: string,
  input: invoicePreorderHoldStore.InvoicePreorderHoldInput,
): Promise<InvoicePreorderHold> {
  await delay()
  return invoicePreorderHoldStore.createInvoicePreorderHold(brandId, input)
}

export async function updateInvoicePreorderHold(
  brandId: string,
  holdId: string,
  input: invoicePreorderHoldStore.InvoicePreorderHoldUpdateInput,
): Promise<InvoicePreorderHold> {
  await delay()
  return invoicePreorderHoldStore.updateInvoicePreorderHold(
    brandId,
    holdId,
    input,
  )
}

export async function extendInvoicePreorderHold(
  brandId: string,
  holdId: string,
  input: invoicePreorderHoldStore.InvoicePreorderHoldExtendInput,
): Promise<InvoicePreorderHold> {
  await delay()
  return invoicePreorderHoldStore.extendInvoicePreorderHold(
    brandId,
    holdId,
    input,
  )
}

export async function endInvoicePreorderHold(
  brandId: string,
  holdId: string,
  input: invoicePreorderHoldStore.InvoicePreorderHoldEndInput,
): Promise<InvoicePreorderHold> {
  await delay()
  return invoicePreorderHoldStore.endInvoicePreorderHold(brandId, holdId, input)
}

export async function deleteInvoicePreorderHold(
  brandId: string,
  holdId: string,
): Promise<void> {
  await delay()
  return invoicePreorderHoldStore.deleteInvoicePreorderHold(brandId, holdId)
}

export async function getInvoiceDiscontinuedStyles(
  brandId: string,
): Promise<InvoiceDiscontinuedStyle[]> {
  return invoiceDiscontinuedStyleStore.listInvoiceDiscontinuedStyles(brandId)
}

export async function createInvoiceDiscontinuedStyle(
  brandId: string,
  input: invoiceDiscontinuedStyleStore.InvoiceDiscontinuedStyleInput,
): Promise<InvoiceDiscontinuedStyle> {
  await delay()
  return invoiceDiscontinuedStyleStore.createInvoiceDiscontinuedStyle(
    brandId,
    input,
  )
}

export async function deleteInvoiceDiscontinuedStyle(
  brandId: string,
  id: string,
): Promise<void> {
  await delay()
  return invoiceDiscontinuedStyleStore.deleteInvoiceDiscontinuedStyle(
    brandId,
    id,
  )
}

export async function getInvoiceProductNameTagRoles(
  brandId: string,
  activeOnly = false,
): Promise<InvoiceProductNameTagRoleEntry[]> {
  return invoiceProductNameTagRoleStore.listInvoiceProductNameTagRoles(brandId, {
    activeOnly,
  })
}

export async function saveInvoiceProductNameTagRole(
  brandId: string,
  input: invoiceProductNameTagRoleStore.InvoiceProductNameTagRoleInput,
  roleId?: string,
): Promise<InvoiceProductNameTagRoleEntry> {
  await delay()
  return invoiceProductNameTagRoleStore.saveInvoiceProductNameTagRole(
    brandId,
    input,
    roleId,
  )
}

export async function applyBulkInvoiceProductNameMaps(
  brandId: string,
  rows: invoiceProductNameMapStore.InvoiceProductNameMapInput[],
): Promise<{
  saved: number
  failures: { index: number; message: string }[]
}> {
  await delay(200)
  return invoiceProductNameMapStore.applyBulkInvoiceProductNameMaps(
    brandId,
    rows,
  )
}

export async function getAiFeatureRoutes(
  brandId: string,
): Promise<AiFeatureRoute[]> {
  return aiSettingsStore.listAiFeatureRoutes(brandId)
}

export async function getAiFeatureRoute(
  brandId: string,
  featureKey: string,
): Promise<AiFeatureRoute | null> {
  return aiSettingsStore.getAiFeatureRoute(brandId, featureKey)
}

export async function saveAiFeatureRoute(
  brandId: string,
  input: {
    featureKey: string
    provider: AiProvider
    modelId: string
    isActive?: boolean
    recommendationPolicy?: AiRecommendationPolicy
    monthlyBudgetUsd?: number | null
  },
): Promise<AiFeatureRoute> {
  return aiSettingsStore.saveAiFeatureRoute(brandId, input)
}

export async function getAiUsageSummary(brandId: string): Promise<AiUsageSummary> {
  return aiSettingsStore.getAiUsageSummary(brandId)
}

export async function listAiModels(provider: AiProvider) {
  return aiGatewayStore.listAiModels(provider)
}

export async function testAiConnection(provider: AiProvider, modelId: string) {
  return aiGatewayStore.testAiConnection(provider, modelId)
}

export async function searchInvoiceProductCandidates(
  brandId: string,
  texts: string[],
  limit = 20,
): Promise<AiProductCandidate[]> {
  return aiCandidateStore.searchInvoiceProductCandidates(brandId, texts, limit)
}

export async function searchInvoiceItemNameCases(
  brandId: string,
  contexts: Array<{
    contextId: string
    itemName: string
    mainStyleId?: string | null
    productLookupKey?: string
  }>,
  limit = 5,
) {
  return aiCandidateStore.searchInvoiceItemNameCases(brandId, contexts, limit)
}

export async function recommendInvoiceProduct(input: {
  brandId: string
  featureKey?: string
  lookupKeys: string[]
  candidates: AiProductCandidate[]
  productName: string
  itemName: string
  mallName: string
}): Promise<AiProductRecommendation> {
  return aiGatewayStore.recommendInvoiceProduct(input)
}

export async function recommendInvoiceAccessoryRules(input: {
  brandId: string
  featureKey?: string
  unknownPiece: string
  itemNames: string[]
  lookupKeys: string[]
  mainProducts: string[]
  contexts?: Array<{
    contextId: string
    itemName: string
    productLookupKey: string
    mainProduct: string
    unknownPieces: string[]
    candidateStyleIds?: string[]
  }>
  dictionary: Array<{
    ruleType: string
    pattern: string
    accessoryKind?: string
    namePrefix?: string
    colorName?: string
  }>
  candidates: AiProductCandidate[]
}): Promise<AiAccessoryRecommendation> {
  return aiGatewayStore.recommendInvoiceAccessoryRules(input)
}

export async function recommendInvoiceItemNameRules(input: {
  brandId: string
  featureKey?: string
  contexts: Array<{
    contextId: string
    itemName: string
    productLookupKey: string
    mainProduct: string
    candidateStyleIds?: string[]
    priorExamples?: Array<{
      itemName: string
      productLookupKey: string
      action: 'delete' | 'components'
      components: Array<{ styleId: string; quantity: number }>
    }>
  }>
  candidates: AiProductCandidate[]
}): Promise<AiItemNameRecommendation> {
  return aiGatewayStore.recommendInvoiceItemNameRules(input)
}

/** 사은품 증정 요청 건. 쇼핑몰명 + 원본 품목명 + 행사 기간으로 찾는다. */
export async function getInvoiceGiftRequests(
  brandId: string,
): Promise<InvoiceGiftRequest[]> {
  return invoicePrefixRequestStore.listInvoicePrefixRequests(brandId)
}

/** @deprecated getInvoiceGiftRequests 사용 */
export async function getInvoicePrefixRequests(
  brandId: string,
): Promise<InvoicePrefixRequest[]> {
  return getInvoiceGiftRequests(brandId)
}

export async function saveInvoiceGiftRequest(
  brandId: string,
  input: invoicePrefixRequestStore.InvoicePrefixRequestInput,
  requestId?: string,
): Promise<InvoiceGiftRequest> {
  await delay()
  return invoicePrefixRequestStore.saveInvoicePrefixRequest(
    brandId,
    input,
    requestId,
  )
}

/** @deprecated saveInvoiceGiftRequest 사용 */
export async function saveInvoicePrefixRequest(
  brandId: string,
  input: invoicePrefixRequestStore.InvoicePrefixRequestInput,
  requestId?: string,
): Promise<InvoicePrefixRequest> {
  return saveInvoiceGiftRequest(brandId, input, requestId)
}

export async function setInvoiceGiftRequestActive(
  id: string,
  isActive: boolean,
): Promise<void> {
  await delay()
  return invoicePrefixRequestStore.setInvoicePrefixRequestActive(id, isActive)
}

/** @deprecated setInvoiceGiftRequestActive 사용 */
export async function setInvoicePrefixRequestActive(
  id: string,
  isActive: boolean,
): Promise<void> {
  return setInvoiceGiftRequestActive(id, isActive)
}

export async function deleteInvoiceGiftRequest(id: string): Promise<void> {
  await delay()
  return invoicePrefixRequestStore.deleteInvoicePrefixRequest(id)
}

/** @deprecated deleteInvoiceGiftRequest 사용 */
export async function deleteInvoicePrefixRequest(id: string): Promise<void> {
  return deleteInvoiceGiftRequest(id)
}

/** 사은품 배정 원장. 활성 배정만 기본 조회한다. */
export async function getInvoiceGiftAllocations(
  brandId: string,
  options?: { requestId?: string; activeOnly?: boolean },
): Promise<InvoiceGiftAllocation[]> {
  return invoiceGiftAllocationStore.listInvoiceGiftAllocations(brandId, options)
}

export async function confirmInvoiceGiftAllocations(
  brandId: string,
  candidates: invoiceGiftAllocationStore.GiftAllocationCandidateInput[],
): Promise<invoiceGiftAllocationStore.ConfirmGiftAllocationsResult> {
  await delay()
  return invoiceGiftAllocationStore.confirmInvoiceGiftAllocations(
    brandId,
    candidates,
  )
}

export async function cancelInvoiceGiftAllocations(
  brandId: string,
  requestId: string,
  orderFingerprint: string,
): Promise<number> {
  await delay()
  return invoiceGiftAllocationStore.cancelInvoiceGiftAllocations(
    brandId,
    requestId,
    orderFingerprint,
  )
}

/** 원본 [사은품] 요청행 치환 매핑. 캠페인형 사은품 추가와 분리한다. */
export async function getInvoiceGiftSourceMaps(
  brandId: string,
  options?: { activeOnly?: boolean },
): Promise<InvoiceGiftSourceMap[]> {
  return invoiceGiftSourceMapStore.listInvoiceGiftSourceMaps(brandId, options)
}

export async function getInvoiceGiftSourceAllocations(
  brandId: string,
  options?: { mapIds?: string[] },
): Promise<InvoiceGiftSourceAllocation[]> {
  return invoiceGiftSourceMapStore.listInvoiceGiftSourceAllocations(
    brandId,
    options,
  )
}

export async function saveInvoiceGiftSourceMap(
  brandId: string,
  input: invoiceGiftSourceMapStore.InvoiceGiftSourceMapInput,
  mapId?: string,
): Promise<InvoiceGiftSourceMap> {
  await delay()
  return invoiceGiftSourceMapStore.saveInvoiceGiftSourceMap(
    brandId,
    input,
    mapId,
  )
}

export async function assignInvoiceGiftSourceRows(
  brandId: string,
  mapId: string,
  requests: invoiceGiftSourceMapStore.InvoiceGiftSourceAssignRequest[],
): Promise<invoiceGiftSourceMapStore.InvoiceGiftSourceAssignResult[]> {
  await delay()
  return invoiceGiftSourceMapStore.assignInvoiceGiftSourceRows(
    brandId,
    mapId,
    requests,
  )
}

export async function confirmInvoiceGiftSourceAllocations(
  brandId: string,
  candidates: invoiceGiftSourceMapStore.InvoiceGiftSourceConfirmRequest[],
): Promise<invoiceGiftSourceMapStore.InvoiceGiftSourceAssignResult[]> {
  await delay()
  return invoiceGiftSourceMapStore.confirmInvoiceGiftSourceAllocations(
    brandId,
    candidates,
  )
}

/** 작업 지시. 완전일치 또는 시작어로 최종 품목명 앞에 표시 문구를 붙인다. */
export async function getInvoiceWorkInstructions(
  brandId: string,
): Promise<InvoiceWorkInstruction[]> {
  return invoiceWorkInstructionStore.listInvoiceWorkInstructions(brandId)
}

export async function saveInvoiceWorkInstruction(
  brandId: string,
  input: invoiceWorkInstructionStore.InvoiceWorkInstructionInput,
  instructionId?: string,
): Promise<InvoiceWorkInstruction> {
  await delay()
  return invoiceWorkInstructionStore.saveInvoiceWorkInstruction(
    brandId,
    input,
    instructionId,
  )
}

export async function setInvoiceWorkInstructionActive(
  id: string,
  isActive: boolean,
): Promise<void> {
  await delay()
  return invoiceWorkInstructionStore.setInvoiceWorkInstructionActive(
    id,
    isActive,
  )
}

export async function deleteInvoiceWorkInstruction(id: string): Promise<void> {
  await delay()
  return invoiceWorkInstructionStore.deleteInvoiceWorkInstruction(id)
}

export async function getInvoiceWorkRuns(
  brandId: string,
): Promise<InvoiceWorkRun[]> {
  return invoiceWorkHistoryStore.listInvoiceWorkRuns(brandId)
}

export async function recordInvoiceWorkCompletion(
  input: Omit<
    invoiceWorkHistoryStore.RecordInvoiceWorkCompletionInput,
    'workerLabel'
  >,
): Promise<string> {
  const profile = await getMyProfile()
  return invoiceWorkHistoryStore.recordInvoiceWorkCompletion({
    ...input,
    workerLabel: profile?.displayName?.trim() || profile?.email || '',
  })
}

export type BulkInvoiceRuleRow = {
  lineNo: number
  input: invoiceNameRuleStore.InvoiceCodeRuleInput
}

export type BulkInvoiceRuleFailure = {
  lineNo: number
  code: string
  message: string
}

/** 자체품번코드 기준 일괄 등록. 미리보기에서 통과한 행만 넘긴다. */
export async function applyBulkInvoiceCodeRules(
  brandId: string,
  rows: BulkInvoiceRuleRow[],
): Promise<{ saved: number; failures: BulkInvoiceRuleFailure[] }> {
  await delay(200)
  if (rows.length === 0) return { saved: 0, failures: [] }

  const failures: BulkInvoiceRuleFailure[] = []
  let saved = 0

  await mapPool(rows, 3, async (row) => {
    try {
      await invoiceNameRuleStore.saveInvoiceCodeRule(brandId, row.input)
      saved += 1
    } catch (error) {
      failures.push({
        lineNo: row.lineNo,
        code: row.input.ownProductCode,
        message:
          error instanceof Error ? error.message : '저장하지 못했습니다.',
      })
    }
  })

  return { saved, failures }
}

/**
 * 출고 거래 단위 코드 API.
 * 자사 바코드(88코드)와 거래처 코드가 같은 스토어를 kind로 구분해 쓴다.
 */
export async function getProductCodes(
  brandId: string,
  kind?: ProductCodeKind,
  usageTargetId?: string,
): Promise<ProductCode[]> {
  await delay()
  return productCodeStore.listProductCodes(brandId, kind, usageTargetId)
}

export async function getPartnerBarcodeFields(
  brandId: string,
  usageTargetId: string,
) {
  await delay()
  return partnerBarcodeFieldStore.listPartnerBarcodeFields(
    brandId,
    usageTargetId,
  )
}

export async function replacePartnerBarcodeFields(
  brandId: string,
  usageTargetId: string,
  fields: Array<{
    id?: string
    label: string
    type: 'text' | 'number'
    order: number
  }>,
) {
  await delay()
  return partnerBarcodeFieldStore.replacePartnerBarcodeFields(
    brandId,
    usageTargetId,
    fields,
  )
}

export async function replacePartnerCodes(
  brandId: string,
  usageTargetId: string,
  codes: Parameters<typeof productCodeStore.replacePartnerCodes>[2],
) {
  await delay()
  return productCodeStore.replacePartnerCodes(brandId, usageTargetId, codes)
}

export async function getBarcodePartnerDisplaySetting(
  brandId: string,
  displayScope: barcodePartnerDisplaySettingStore.BarcodePartnerDisplayScope,
) {
  await delay()
  return barcodePartnerDisplaySettingStore.getBarcodePartnerDisplaySetting(
    brandId,
    displayScope,
  )
}

export async function replaceBarcodePartnerDisplayTargets(
  brandId: string,
  displayScope: barcodePartnerDisplaySettingStore.BarcodePartnerDisplayScope,
  targetIds: string[],
) {
  await delay()
  return barcodePartnerDisplaySettingStore.replaceBarcodePartnerDisplayTargets(
    brandId,
    displayScope,
    targetIds,
  )
}

export async function initializeBarcodePartnerDisplayTargets(
  brandId: string,
  displayScope: barcodePartnerDisplaySettingStore.BarcodePartnerDisplayScope,
  targetIds: string[],
) {
  await delay()
  return barcodePartnerDisplaySettingStore.initializeBarcodePartnerDisplayTargets(
    brandId,
    displayScope,
    targetIds,
  )
}

export async function getBulkOutboundPartnerConfigs(
  brandId: string,
  partnerNameById: Map<string, string>,
) {
  await delay()
  return bulkOutboundStore.listBulkOutboundPartnerConfigs(
    brandId,
    partnerNameById,
  )
}

export async function replaceBulkOutboundPartnerConfigs(
  brandId: string,
  configs: Array<{
    partnerId: string
    barcodeSource: bulkOutboundStore.BulkOutboundBarcodeSource
    workStatus?: bulkOutboundStore.BulkOutboundPartnerWorkStatus
  }>,
) {
  await delay()
  return bulkOutboundStore.replaceBulkOutboundPartnerConfigs(brandId, configs)
}

export async function getBulkOutboundTemplateFields(
  brandId: string,
  partnerId: string,
  barcodeSource: bulkOutboundStore.BulkOutboundBarcodeSource,
) {
  await delay()
  return bulkOutboundStore.listBulkOutboundTemplateFields(
    brandId,
    partnerId,
    barcodeSource,
  )
}

export async function replaceBulkOutboundTemplateFields(
  brandId: string,
  partnerId: string,
  barcodeSource: bulkOutboundStore.BulkOutboundBarcodeSource,
  fields: bulkOutboundStore.BulkOutboundTemplateField[],
) {
  await delay()
  return bulkOutboundStore.replaceBulkOutboundTemplateFields(
    brandId,
    partnerId,
    barcodeSource,
    fields,
  )
}

export async function initializeBulkOutboundTemplateFields(
  brandId: string,
  partnerId: string,
  barcodeSource: bulkOutboundStore.BulkOutboundBarcodeSource,
  fields: bulkOutboundStore.BulkOutboundTemplateField[],
) {
  await delay()
  return bulkOutboundStore.initializeBulkOutboundTemplateFields(
    brandId,
    partnerId,
    barcodeSource,
    fields,
  )
}

export async function getBulkOutboundJobs(
  brandId: string,
  partnerNameById: Map<string, string>,
) {
  await delay()
  return bulkOutboundStore.listBulkOutboundJobs(brandId, partnerNameById)
}

export async function saveBulkOutboundJob(
  brandId: string,
  input: bulkOutboundStore.BulkOutboundJobInput,
) {
  await delay()
  return bulkOutboundStore.saveBulkOutboundJob(brandId, input)
}

export async function updateBulkOutboundJobMeta(
  brandId: string,
  jobId: string,
  assignee: string,
  input: Parameters<typeof bulkOutboundStore.updateBulkOutboundJobMeta>[3],
) {
  await delay()
  return bulkOutboundStore.updateBulkOutboundJobMeta(
    brandId,
    jobId,
    assignee,
    input,
  )
}

export async function getBulkOutboundBackupSummary(
  brandId: string,
  jobId: string,
) {
  await delay()
  return bulkOutboundStore.getBulkOutboundBackupSummary(brandId, jobId)
}

export async function deleteBulkOutboundJob(
  brandId: string,
  jobId: string,
  assignee: string,
) {
  await delay()
  return bulkOutboundStore.deleteBulkOutboundJob(brandId, jobId, assignee)
}

export async function replaceBulkOutboundBackup(
  input: Parameters<typeof bulkOutboundStore.replaceBulkOutboundBackup>[0],
) {
  await delay()
  return bulkOutboundStore.replaceBulkOutboundBackup(input)
}

export async function getOutboundShipments(brandId: string) {
  await delay()
  return outboundShipmentStore.listOutboundShipments(brandId)
}

export async function createProductCode(
  brandId: string,
  input: ProductCodeInput,
): Promise<ProductCode> {
  await delay()
  return productCodeStore.createProductCode(brandId, input)
}

export async function updateProductCode(
  id: string,
  input: ProductCodeInput,
): Promise<ProductCode> {
  await delay()
  return productCodeStore.updateProductCode(id, input)
}

export async function deleteProductCode(id: string): Promise<void> {
  await delay()
  return productCodeStore.deleteProductCode(id)
}

export type BulkBarcodeApplyRow = {
  lineNo: number
  input: ProductCodeInput
}

export type BulkBarcodeFailure = {
  lineNo: number
  code: string
  message: string
}

/** 제한된 동시성으로 비동기 작업을 돌린다. 행마다 RPC를 치되 브라우저를 막지 않는다. */
async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return
  let next = 0
  async function run() {
    while (next < items.length) {
      const index = next
      next += 1
      await worker(items[index]!)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run()),
  )
}

/**
 * 자사 바코드 일괄 등록. 기존 코드는 덮어쓰지 않고 신규만 만든다.
 * 미리보기에서 통과한 행만 넘긴다.
 */
export async function applyBulkProductCodes(
  brandId: string,
  rows: BulkBarcodeApplyRow[],
): Promise<{ created: number; failures: BulkBarcodeFailure[] }> {
  await delay(200)
  if (rows.length === 0) return { created: 0, failures: [] }

  const failures: BulkBarcodeFailure[] = []
  let created = 0

  await mapPool(rows, 5, async (row) => {
    try {
      await productCodeStore.createProductCode(brandId, row.input)
      created += 1
    } catch (error) {
      failures.push({
        lineNo: row.lineNo,
        code: row.input.code,
        message:
          error instanceof Error ? error.message : '저장에 실패했습니다.',
      })
    }
  })

  return { created, failures }
}

export type BulkBarcodeUpdateRow = {
  lineNo: number
  codeId: string
  input: ProductCodeInput
}

export type BulkBarcodeFillRow = BulkBarcodeUpdateRow

/**
 * 기존 자사 바코드를 제한된 동시성으로 갱신한다.
 * 호출부가 미리보기에서 통과한 행만 넘긴다.
 */
async function applyBulkBarcodeUpdates(
  rows: BulkBarcodeUpdateRow[],
): Promise<{ updated: number; failures: BulkBarcodeFailure[] }> {
  await delay(200)
  if (rows.length === 0) return { updated: 0, failures: [] }

  const failures: BulkBarcodeFailure[] = []
  let updated = 0

  await mapPool(rows, 5, async (row) => {
    try {
      await productCodeStore.updateProductCode(row.codeId, row.input)
      updated += 1
    } catch (error) {
      failures.push({
        lineNo: row.lineNo,
        code: row.input.code,
        message:
          error instanceof Error ? error.message : '저장에 실패했습니다.',
      })
    }
  })

  return { updated, failures }
}

/** 미지정 자사 바코드에 M번호(구성품)만 채운다. */
export async function applyBulkBarcodeComponents(rows: BulkBarcodeFillRow[]) {
  return applyBulkBarcodeUpdates(rows)
}

/** 88코드로 매칭한 기존 자사 바코드의 포장 정보를 갱신한다. */
export async function applyBulkBarcodeInfo(rows: BulkBarcodeUpdateRow[]) {
  return applyBulkBarcodeUpdates(rows)
}

export async function getCodeUsageTargets(
  brandId: string,
): Promise<CodeUsageTarget[]> {
  return codeUsageTargetStore.listCodeUsageTargets(brandId)
}

export async function createCodeUsageTarget(
  brandId: string,
  input: CodeUsageTargetInput,
): Promise<CodeUsageTarget> {
  await delay()
  return codeUsageTargetStore.createCodeUsageTarget(brandId, input)
}

export async function saveCodeUsageTarget(
  brandId: string,
  input: codeUsageTargetStore.SaveCodeUsageTargetInput,
): Promise<CodeUsageTarget> {
  await delay()
  return codeUsageTargetStore.saveCodeUsageTarget(brandId, input)
}

export async function addCodeUsageTargetAlias(
  brandId: string,
  targetId: string,
  alias: string,
): Promise<void> {
  await delay()
  return codeUsageTargetStore.addCodeUsageTargetAlias(brandId, targetId, alias)
}

export async function updateCodeUsageTarget(
  id: string,
  patch: Partial<
    Pick<
      CodeUsageTarget,
      | 'name'
      | 'active'
      | 'isOneTime'
      | 'channelType'
      | 'shippingMethod'
      | 'note'
      | 'folderId'
    >
  > & { aliases?: readonly string[] },
): Promise<CodeUsageTarget> {
  await delay()
  return codeUsageTargetStore.updateCodeUsageTarget(id, patch)
}

export async function getCodeUsageTargetAliases(
  brandId: string,
): Promise<CodeUsageTargetAlias[]> {
  return codeUsageTargetStore.listCodeUsageTargetAliases(brandId)
}

/** 초기 목록을 여러 줄 붙여넣기로 한 번에 등록한다. */
export async function createCodeUsageTargetsBulk(
  brandId: string,
  rows: readonly BulkCodeUsageTargetRow[],
): Promise<BulkCodeUsageTargetResult> {
  await delay()
  return codeUsageTargetStore.createCodeUsageTargetsBulk(brandId, rows)
}

export async function getCodeUsageTargetFolders(
  brandId: string,
): Promise<CodeUsageTargetFolder[]> {
  return codeUsageTargetFolderStore.listCodeUsageTargetFolders(brandId)
}

export async function createCodeUsageTargetFolder(
  brandId: string,
  input: { name: string; parentId?: string | null },
): Promise<CodeUsageTargetFolder> {
  await delay()
  return codeUsageTargetFolderStore.createCodeUsageTargetFolder(brandId, input)
}

export async function updateCodeUsageTargetFolder(
  id: string,
  patch: { name?: string; parentId?: string | null },
): Promise<CodeUsageTargetFolder> {
  await delay()
  return codeUsageTargetFolderStore.updateCodeUsageTargetFolder(id, patch)
}

export async function deleteCodeUsageTargetFolder(id: string): Promise<void> {
  await delay()
  return codeUsageTargetFolderStore.deleteCodeUsageTargetFolder(id)
}

export async function getCodeUsageAssignments(
  brandId: string,
  options?: {
    usageTargetId?: string
    productCodeId?: string
    status?: CodeUsageStatus
  },
): Promise<CodeUsageAssignment[]> {
  await delay()
  return codeUsageAssignmentStore.listCodeUsageAssignments(brandId, options)
}

export async function createCodeUsageAssignment(
  brandId: string,
  input: CodeUsageAssignmentInput,
): Promise<CodeUsageAssignment> {
  await delay()
  return codeUsageAssignmentStore.createCodeUsageAssignment(brandId, input)
}

export async function createCodeUsageAssignments(
  brandId: string,
  productCodeIds: string[],
  usageTargetId: string,
  status: CodeUsageStatus = 'active',
): Promise<CodeUsageAssignment[]> {
  await delay()
  const results: CodeUsageAssignment[] = []
  for (const productCodeId of productCodeIds) {
    results.push(
      await codeUsageAssignmentStore.createCodeUsageAssignment(brandId, {
        productCodeId,
        usageTargetId,
        status,
      }),
    )
  }
  return results
}

export async function updateCodeUsageAssignmentStatus(
  id: string,
  status: CodeUsageStatus,
): Promise<CodeUsageAssignment> {
  await delay()
  return codeUsageAssignmentStore.updateCodeUsageAssignmentStatus(id, status)
}

export type BulkUsageApplyRow = {
  productCodeId: string
  status: CodeUsageStatus
}

export async function applyBulkUsageAssignments(
  brandId: string,
  usageTargetId: string,
  rows: BulkUsageApplyRow[],
): Promise<{ created: number; updated: number; skipped: number }> {
  await delay(200)
  return codeUsageAssignmentStore.applyBulkUsageAssignments(
    brandId,
    usageTargetId,
    rows,
  )
}

export async function getProductDrafts(
  brandId: string,
): Promise<ProductDraft[]> {
  await delay()
  return productDraftStore.listProductDrafts(brandId)
}

export async function getProductDraftById(
  id: string,
): Promise<ProductDraft | undefined> {
  await delay()
  return productDraftStore.getProductDraftById(id)
}

export async function createProductDraft(
  brandId: string,
  input: ProductDraftInput,
): Promise<ProductDraft> {
  await delay()
  return productDraftStore.createProductDraft(brandId, input)
}

export async function updateProductDraft(
  id: string,
  input: ProductDraftInput,
): Promise<ProductDraft> {
  await delay()
  return productDraftStore.updateProductDraft(id, input)
}

export async function deleteProductDraft(id: string): Promise<void> {
  await delay()
  return productDraftStore.deleteProductDraft(id)
}

export async function getSeasonsByBrand(brandId: string): Promise<Season[]> {
  await delay()
  return seasonStore.listSeasons(brandId)
}

export async function createSeason(
  brandId: string,
  input: SeasonInput,
): Promise<Season> {
  await delay()
  return seasonStore.createSeason(brandId, input)
}

export async function updateSeason(
  id: string,
  input: SeasonInput,
): Promise<Season> {
  await delay()
  return seasonStore.updateSeason(id, input)
}

export async function deleteSeason(id: string): Promise<void> {
  await delay()
  const styleCount = await styleStore.countStylesBySeason(id)
  const draftCount = await productDraftStore.countProductDraftsBySeason(id)
  return seasonStore.deleteSeason(id, { styleCount, draftCount })
}

export async function getStylesByBrand(
  brandId: string,
  seasonId?: string,
): Promise<Style[]> {
  await delay()
  return styleStore.listStyles(brandId, seasonId)
}

/** 데이터 시트처럼 한 화면 분량만 필요한 곳에서 쓴다. */
export async function getStylesPage(
  brandId: string,
  filter: styleStore.StyleFilter,
  offset: number,
  limit: number,
): Promise<{ rows: Style[]; total: number }> {
  await delay()
  return styleStore.listStylesPage(brandId, filter, offset, limit)
}

/** 같은 조건의 전체 목록. 내보내기처럼 한 번에 다 필요할 때만 쓴다. */
export async function getStylesFiltered(
  brandId: string,
  filter: styleStore.StyleFilter,
): Promise<Style[]> {
  await delay()
  return styleStore.listStylesFiltered(brandId, filter)
}

/** 송장·접두어 상품 선택용. M번호·상품명으로 검색하고 styleId를 돌려준다. */
export async function searchStyleRefs(
  brandId: string,
  search: string,
  limit = 8,
) {
  await delay()
  return styleStore.searchStyleRefs(brandId, search, limit)
}

export async function listStyleRefsByStyleNos(
  brandId: string,
  styleNos: string[],
) {
  await delay()
  return styleStore.listStyleRefsByStyleNos(brandId, styleNos)
}

export async function listStyleRefsByNames(
  brandId: string,
  names: string[],
) {
  await delay()
  return styleStore.listStyleRefsByNames(brandId, names)
}

export async function listStyleRefsForLookup(
  brandId: string,
  options: { styleNos?: string[]; names?: string[] },
) {
  await delay()
  return styleStore.listStyleRefsForLookup(brandId, options)
}

export async function listAllStyleRefs(brandId: string) {
  return styleStore.listAllStyleRefs(brandId)
}

export async function getStyleById(
  styleId: string,
): Promise<Style | undefined> {
  await delay()
  return styleStore.getStyleById(styleId)
}

export async function getStyleByStyleNo(
  brandId: string,
  styleNo: string,
): Promise<Style | undefined> {
  await delay()
  return styleStore.getStyleByStyleNo(brandId, styleNo)
}

export async function createStyle(
  brandId: string,
  input: StyleInput,
): Promise<Style> {
  await delay()
  return styleStore.createStyle(brandId, input)
}

export async function updateStyle(
  id: string,
  input: Partial<StyleInput>,
): Promise<Style> {
  await delay()
  return styleStore.updateStyle(id, input)
}

export async function updateStyleFields(
  id: string,
  patch: Record<string, string>,
): Promise<Style> {
  await delay()
  const existing = await styleStore.getStyleById(id)
  if (!existing) {
    throw new styleStore.StyleStoreError(
      '상품을 찾을 수 없습니다.',
      'not_found',
    )
  }
  const seasons = await seasonStore.listSeasons(existing.brandId)
  const seasonIdByCode = new Map(
    seasons.map((season) => [season.code.toUpperCase(), season.id]),
  )
  return styleStore.updateStyleFields(id, patch, { seasonIdByCode })
}

export async function deleteStyle(id: string): Promise<void> {
  await delay()
  return styleStore.deleteStyle(id)
}

export type ImportApplyRow = {
  lineNo: number
  styleNo: string
  matchKey: string
  targetStyleId?: string
  /** 기본은 upsert. delete면 이 행의 상품을 지운다. */
  action?: 'upsert' | 'delete'
  applied: Record<string, unknown>
  customFields: Record<string, string>
  /** 빈 칸으로 비울 시스템 항목 키 */
  clearKeys?: string[]
  /** 빈 칸으로 비울 사용자 추가 컬럼 이름 */
  clearCustomFields?: string[]
}

export type ImportFailure = {
  lineNo: number
  styleNo: string
  message: string
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown) {
  return typeof value === 'number' ? value : undefined
}

/** applied Record → updateStyleFields용 문자열 패치 */
function appliedToFieldPatch(
  applied: Record<string, unknown>,
): Record<string, string> {
  const patch: Record<string, string> = {}

  // _id로 찾은 행은 품번 자체를 바꿀 수 있다.
  const styleNo = asString(applied.styleNo)
  if (styleNo !== undefined) patch.styleNo = styleNo

  const name = asString(applied.name)
  if (name !== undefined) patch.name = name

  const category = asString(applied.category)
  if (category !== undefined) patch.category = category

  const planner = asString(applied.planner)
  if (planner !== undefined) patch.planner = planner

  const designer = asString(applied.designer)
  if (designer !== undefined) patch.designer = designer

  const description = asString(applied.description)
  if (description !== undefined) patch.description = description

  const seasonId = asString(applied.seasonId)
  if (seasonId !== undefined) patch.seasonId = seasonId

  const gender = asString(applied.gender)
  if (gender !== undefined) patch.gender = gender

  if (Array.isArray(applied.colors)) {
    patch.colors = (applied.colors as string[]).join(', ')
  }

  const plannedQty = asNumber(applied.plannedQty)
  if (plannedQty !== undefined) patch.plannedQty = String(plannedQty)

  const targetCost = asNumber(applied.targetCost)
  if (targetCost !== undefined) patch.targetCost = String(targetCost)

  const retailPrice = asNumber(applied.retailPrice)
  if (retailPrice !== undefined) patch.retailPrice = String(retailPrice)

  const weightG = asNumber(applied.weightG)
  if (weightG !== undefined) patch.weightG = String(weightG)

  const fabric = asString(applied.fabric)
  if (fabric !== undefined) patch.fabric = fabric

  const orderQty = asNumber(applied.orderQty)
  if (orderQty !== undefined) patch.orderQty = String(orderQty)

  const channel = asString(applied.channel)
  if (channel !== undefined) patch.channel = channel

  const warehouse = asString(applied.warehouse)
  if (warehouse !== undefined) patch.warehouse = warehouse

  const onHand = asNumber(applied.onHand)
  if (onHand !== undefined) patch.onHand = String(onHand)

  const reserved = new Set([
    'styleNo',
    'name',
    'category',
    'planner',
    'designer',
    'description',
    'seasonId',
    'gender',
    'colors',
    'plannedQty',
    'targetCost',
    'retailPrice',
    'weightG',
    'fabric',
    'orderQty',
    'channel',
    'warehouse',
    'onHand',
  ])
  for (const [key, value] of Object.entries(applied)) {
    if (reserved.has(key) || key in patch) continue
    if (typeof value === 'string') patch[key] = value
  }

  return patch
}

/** 신규 행은 저장 전에 메모리에서 상품 한 건을 다 만든다. */
function appliedToStyleInput(
  row: ImportApplyRow,
  seasonId: string,
): Parameters<typeof styleStore.createStyle>[1] {
  const styleNo = row.styleNo.trim()
  const patch = appliedToFieldPatch(row.applied)
  const base: Style = {
    id: '',
    brandId: '',
    seasonId,
    styleNo,
    name: asString(row.applied.name) ?? styleNo,
    category: '미분류',
    gender: 'U',
    colors: [],
    targetCost: null,
    plannedQty: null,
    retailPrice: null,
    status: 'draft',
    thumbnailColor: '',
    weightG: null,
    values: {},
    customFields: { ...row.customFields },
  }

  // 시즌은 이미 정해졌으니 패치에서 빼고 나머지 값만 얹는다.
  const { seasonId: _ignored, ...rest } = patch
  const merged = styleStore.applyStyleFieldPatch(base, rest, {
    emptyMeans: 'keep',
  })

  return {
    seasonId,
    styleNo: merged.styleNo,
    name: merged.name,
    category: merged.category,
    gender: merged.gender,
    colors: merged.colors,
    targetCost: merged.targetCost,
    plannedQty: merged.plannedQty,
    retailPrice: merged.retailPrice,
    status: merged.status,
    designer: merged.designer,
    planner: merged.planner,
    description: merged.description,
    weightG: merged.weightG,
    values: merged.values,
    customFields: merged.customFields,
  }
}

/**
 * _id 또는 품번으로 기존 상품을 찾아 병합하고, 없으면 새로 만든다.
 * action이 delete인 행은 상품을 지운다.
 * 수천 행을 위해 상품을 한 번만 읽고 메모리에서 병합한 뒤 청크로 저장한다.
 * 한 행이 실패해도 나머지는 계속 반영하고, 실패한 행은 목록으로 돌려준다.
 */
export async function applyProductImport(
  brandId: string,
  rows: ImportApplyRow[],
): Promise<{
  created: number
  updated: number
  deleted: number
  failures: ImportFailure[]
}> {
  await delay(200)

  const failures: ImportFailure[] = []
  const rowByLineNo = new Map(rows.map((row) => [row.lineNo, row]))
  function pushFailures(items: { ref: number; message: string }[]) {
    for (const item of items) {
      failures.push({
        lineNo: item.ref,
        styleNo: rowByLineNo.get(item.ref)?.styleNo ?? '',
        message: item.message,
      })
    }
  }

  const seasons = await seasonStore.listSeasons(brandId)
  const seasonIdByCode = new Map(
    seasons.map((season) => [season.code.toUpperCase(), season.id]),
  )

  // 상품을 행마다 다시 읽지 않는다. 한 번 읽어 두고 메모리에서 찾는다.
  const existingStyles = await styleStore.listStyles(brandId)
  const styleById = new Map(existingStyles.map((style) => [style.id, style]))
  const styleByNo = new Map(
    existingStyles.map((style) => [style.styleNo.trim(), style]),
  )

  // 시즌을 적지 않은 신규 상품은 보관용 기획에 담는다.
  // 출시 기획이 아직 없어도 기존 상품을 먼저 올릴 수 있게 한다.
  let fallbackSeasonId: string | undefined
  async function resolveFallbackSeasonId() {
    if (!fallbackSeasonId) {
      const season = await seasonStore.ensureUnassignedSeason(brandId)
      fallbackSeasonId = season.id
    }
    return fallbackSeasonId
  }

  const toDelete: { ref: number; id: string }[] = []
  const toInsert: {
    ref: number
    input: Parameters<typeof styleStore.createStyle>[1]
  }[] = []
  const toSave: { ref: number; style: Style }[] = []

  for (const row of rows) {
    try {
      const style =
        (row.targetStyleId ? styleById.get(row.targetStyleId) : undefined) ??
        (row.styleNo.trim() ? styleByNo.get(row.styleNo.trim()) : undefined)

      if (row.action === 'delete') {
        if (!style) throw new Error('삭제할 상품을 찾을 수 없습니다.')
        toDelete.push({ ref: row.lineNo, id: style.id })
        continue
      }

      if (!style) {
        const seasonId =
          asString(row.applied.seasonId) ?? (await resolveFallbackSeasonId())
        toInsert.push({
          ref: row.lineNo,
          input: appliedToStyleInput(row, seasonId),
        })
        continue
      }

      const patch = appliedToFieldPatch(row.applied)
      let next = styleStore.applyStyleFieldPatch(style, patch, {
        seasonIdByCode,
        emptyMeans: 'keep',
      })

      // 빈 칸으로 지우라고 지시한 열만 따로 비운다.
      const clearKeys = (row.clearKeys ?? []).filter((key) => !(key in patch))
      if (clearKeys.length > 0) {
        const clearPatch: Record<string, string> = {}
        for (const key of clearKeys) clearPatch[key] = ''
        next = styleStore.applyStyleFieldPatch(next, clearPatch, {
          seasonIdByCode,
          emptyMeans: 'clear',
        })
      }

      const clearCustom = row.clearCustomFields ?? []
      if (Object.keys(row.customFields).length > 0 || clearCustom.length > 0) {
        const merged = { ...(next.customFields ?? {}), ...row.customFields }
        for (const key of clearCustom) delete merged[key]
        next = { ...next, customFields: merged }
      }

      toSave.push({ ref: row.lineNo, style: next })
    } catch (error) {
      failures.push({
        lineNo: row.lineNo,
        styleNo: row.styleNo,
        message:
          error instanceof Error
            ? error.message
            : '알 수 없는 오류로 반영하지 못했습니다.',
      })
    }
  }

  // 삭제를 먼저 처리해 같은 품번을 지웠다가 다시 넣는 파일도 통과시킨다.
  const deleteResult = await styleStore.deleteStylesBulk(toDelete)
  pushFailures(deleteResult.failures)

  const saveResult = await styleStore.saveStylesBulk(toSave)
  pushFailures(saveResult.failures)

  const insertResult = await styleStore.insertStylesBulk(brandId, toInsert)
  pushFailures(insertResult.failures)

  return {
    created: insertResult.created,
    updated: saveResult.updated,
    deleted: deleteResult.deleted,
    failures,
  }
}
