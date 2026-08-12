import type {
  Brand,
  BrandInput,
  BrandField,
  BrandFieldInput,
  BarcodeField,
  BarcodeFieldInput,
  CodeUsageAssignment,
  CodeUsageAssignmentInput,
  CodeUsageStatus,
  CodeUsageTarget,
  CodeUsageTargetInput,
  InvoiceNameRule,
  InvoicePrefixRequest,
  ProductCode,
  ProductCodeInput,
  ProductCodeKind,
  ProductDraft,
  ProductDraftInput,
  Season,
  SeasonInput,
  Style,
  StyleInput,
} from '@/lib/types'
import * as brandStore from '@/lib/supabase/brands'
import { getMyProfile } from '@/lib/supabase/profiles'
import * as brandFieldStore from '@/lib/supabase/brand-fields'
import * as barcodeFieldStore from '@/lib/supabase/barcode-fields'
import * as codeUsageTargetStore from '@/lib/supabase/code-usage-targets'
import * as codeUsageAssignmentStore from '@/lib/supabase/code-usage-assignments'
import * as invoiceNameRuleStore from '@/lib/supabase/invoice-name-rules'
import * as invoicePrefixRequestStore from '@/lib/supabase/invoice-prefix-requests'
import * as productCodeStore from '@/lib/supabase/product-codes'
import * as productDraftStore from '@/lib/supabase/product-drafts'
import * as seasonStore from '@/lib/supabase/seasons'
import * as styleStore from '@/lib/supabase/styles'

const delay = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms))

export { BrandStoreError } from '@/lib/supabase/brands'
export { BrandFieldStoreError } from '@/lib/supabase/brand-fields'
export { BarcodeFieldStoreError } from '@/lib/supabase/barcode-fields'
export { CodeUsageTargetStoreError } from '@/lib/supabase/code-usage-targets'
export { CodeUsageAssignmentStoreError } from '@/lib/supabase/code-usage-assignments'
export { InvoiceNameRuleStoreError } from '@/lib/supabase/invoice-name-rules'
export type {
  InvoiceCodeRuleInput,
  InvoiceNameRuleUpdateInput,
} from '@/lib/supabase/invoice-name-rules'
export { InvoicePrefixRequestStoreError } from '@/lib/supabase/invoice-prefix-requests'
export type {
  InvoicePrefixItemInput,
  InvoicePrefixRequestInput,
} from '@/lib/supabase/invoice-prefix-requests'
export { ProductCodeStoreError } from '@/lib/supabase/product-codes'
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
  await delay()
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

/** 접두어는 요청 건 단위로 관리하고 쇼핑몰명 + 원본 품목명 완전 일치로 찾는다. */
export async function getInvoicePrefixRequests(
  brandId: string,
): Promise<InvoicePrefixRequest[]> {
  await delay()
  return invoicePrefixRequestStore.listInvoicePrefixRequests(brandId)
}

export async function saveInvoicePrefixRequest(
  brandId: string,
  input: invoicePrefixRequestStore.InvoicePrefixRequestInput,
  requestId?: string,
): Promise<InvoicePrefixRequest> {
  await delay()
  return invoicePrefixRequestStore.saveInvoicePrefixRequest(
    brandId,
    input,
    requestId,
  )
}

export async function setInvoicePrefixRequestActive(
  id: string,
  isActive: boolean,
): Promise<void> {
  await delay()
  return invoicePrefixRequestStore.setInvoicePrefixRequestActive(id, isActive)
}

export async function deleteInvoicePrefixRequest(id: string): Promise<void> {
  await delay()
  return invoicePrefixRequestStore.deleteInvoicePrefixRequest(id)
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
): Promise<ProductCode[]> {
  await delay()
  return productCodeStore.listProductCodes(brandId, kind)
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
  await delay()
  return codeUsageTargetStore.listCodeUsageTargets(brandId)
}

export async function createCodeUsageTarget(
  brandId: string,
  input: CodeUsageTargetInput,
): Promise<CodeUsageTarget> {
  await delay()
  return codeUsageTargetStore.createCodeUsageTarget(brandId, input)
}

export async function updateCodeUsageTarget(
  id: string,
  patch: Partial<Pick<CodeUsageTarget, 'name' | 'active'>>,
): Promise<CodeUsageTarget> {
  await delay()
  return codeUsageTargetStore.updateCodeUsageTarget(id, patch)
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

/** 송장 공식명 입력용. 데이터 시트에 등록된 상품명만 검색한다. */
export async function searchStyleNames(
  brandId: string,
  search: string,
  limit = 3,
): Promise<string[]> {
  await delay()
  return styleStore.searchStyleNames(brandId, search, limit)
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
