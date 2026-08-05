import type {
  Brand,
  BrandInput,
  BrandField,
  BrandFieldInput,
  CodeUsageAssignment,
  CodeUsageAssignmentInput,
  CodeUsageStatus,
  CodeUsageTarget,
  CodeUsageTargetInput,
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
import * as brandStore from '@/lib/db/brands'
import * as brandFieldStore from '@/lib/db/brand-fields'
import * as codeUsageTargetStore from '@/lib/db/code-usage-targets'
import * as codeUsageAssignmentStore from '@/lib/db/code-usage-assignments'
import * as productCodeStore from '@/lib/db/product-codes'
import * as productDraftStore from '@/lib/db/product-drafts'
import * as seasonStore from '@/lib/db/seasons'
import * as styleStore from '@/lib/db/styles'

const delay = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms))

export { BrandStoreError } from '@/lib/db/brands'
export { BrandFieldStoreError } from '@/lib/db/brand-fields'
export { CodeUsageTargetStoreError } from '@/lib/db/code-usage-targets'
export { CodeUsageAssignmentStoreError } from '@/lib/db/code-usage-assignments'
export { ProductCodeStoreError } from '@/lib/db/product-codes'
export {
  ProductDraftStoreError,
  emptyDraftInput,
  newColorRow,
  newOptionRow,
  MAX_DRAFT_COLORS,
} from '@/lib/db/product-drafts'
export { SeasonStoreError } from '@/lib/db/seasons'
export { StyleStoreError } from '@/lib/db/styles'

/**
 * 브랜드 API.
 * 현재는 IndexedDB 구현체를 호출한다. Supabase 합류 시 brandStore 교체만 하면 된다.
 */
export async function getBrands(): Promise<Brand[]> {
  await delay()
  return brandStore.listBrands()
}

export async function getBrandBySlug(slug: string): Promise<Brand | undefined> {
  await delay()
  return brandStore.getBrandBySlug(slug)
}

export async function createBrand(input: BrandInput): Promise<Brand> {
  await delay()
  return brandStore.createBrand(input)
}

export async function updateBrand(
  id: string,
  input: BrandInput,
): Promise<Brand> {
  await delay()
  return brandStore.updateBrand(id, input)
}

export async function deleteBrand(id: string): Promise<void> {
  await delay()
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

export async function getStyleById(styleId: string): Promise<Style | undefined> {
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

export type StyleFieldBulkEdit = {
  styleId: string
  patch: Record<string, string>
}

export type StyleFieldBulkFailure = {
  styleId: string
  message: string
}

/**
 * 붙여넣기용 일괄 저장. 시즌 맵을 한 번만 만들고 행별 성공·실패를 모은다.
 */
export async function updateStyleFieldsBulk(
  brandId: string,
  edits: StyleFieldBulkEdit[],
): Promise<{
  updated: number
  failures: StyleFieldBulkFailure[]
}> {
  if (edits.length === 0) return { updated: 0, failures: [] }

  const seasons = await seasonStore.listSeasons(brandId)
  const seasonIdByCode = new Map(
    seasons.map((season) => [season.code.toUpperCase(), season.id]),
  )

  let updated = 0
  const failures: StyleFieldBulkFailure[] = []

  for (const edit of edits) {
    try {
      await styleStore.updateStyleFields(edit.styleId, edit.patch, {
        seasonIdByCode,
      })
      updated += 1
    } catch (error) {
      failures.push({
        styleId: edit.styleId,
        message:
          error instanceof Error ? error.message : '저장에 실패했습니다.',
      })
    }
  }

  return { updated, failures }
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
  applied: Record<string, unknown>
  customFields: Record<string, string>
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

/**
 * 품번으로 기존 상품을 찾아 병합하고, 없으면 새로 만든다.
 * 한 행이 실패해도 나머지는 계속 반영하고, 실패한 행은 목록으로 돌려준다.
 */
export async function applyProductImport(
  brandId: string,
  rows: ImportApplyRow[],
): Promise<{
  created: number
  updated: number
  failures: ImportFailure[]
}> {
  await delay(200)

  let created = 0
  let updated = 0
  const failures: ImportFailure[] = []

  const seasons = await seasonStore.listSeasons(brandId)
  const seasonIdByCode = new Map(
    seasons.map((season) => [season.code.toUpperCase(), season.id]),
  )
  const defaultSeasonId = seasons[0]?.id

  for (const row of rows) {
    try {
      let style = row.targetStyleId
        ? await styleStore.getStyleById(row.targetStyleId)
        : undefined

      if (!style) {
        style = await styleStore.getStyleByStyleNo(brandId, row.styleNo)
      }

      let isNew = false
      if (!style) {
        const seasonId = asString(row.applied.seasonId) ?? defaultSeasonId
        if (!seasonId) {
          throw new Error('시즌이 없어 새 상품을 만들 수 없습니다.')
        }

        style = await styleStore.createStyle(brandId, {
          seasonId,
          styleNo: row.styleNo.trim(),
          name: asString(row.applied.name) ?? row.styleNo.trim(),
        })
        isNew = true
      }

      const patch = appliedToFieldPatch(row.applied)
      if (Object.keys(patch).length > 0) {
        // 시트의 빈 칸이 이미 입력된 값을 지우지 않도록 한다.
        await styleStore.updateStyleFields(style.id, patch, {
          seasonIdByCode,
          emptyMeans: 'keep',
        })
      }

      if (Object.keys(row.customFields).length > 0) {
        const current = await styleStore.getStyleById(style.id)
        await styleStore.updateStyle(style.id, {
          customFields: {
            ...(current?.customFields ?? {}),
            ...row.customFields,
          },
        })
      }

      if (isNew) created += 1
      else updated += 1
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

  return { created, updated, failures }
}
