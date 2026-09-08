import type {
  DraftColorRow,
  DraftOptionRow,
  DraftSpecKey,
  ProductDraft,
  ProductDraftInput,
} from '@/lib/types'
import { emptyDraftInput } from '@/lib/drafts/empty-draft'
import { normalizeDraftBrandId, parseDraftNo } from '@/lib/drafts/company-draft'
import { sanitizeColorWorkOrder } from '@/lib/drafts/draft-flow'
import {
  isSamplePassed,
  legacyWorkOrderFields,
  normalizeSampleWorkOrders,
  sanitizeSampleWorkOrders,
} from '@/lib/drafts/sample-work-order'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isMissingColumn } from '@/lib/supabase/map-error'

export {
  MAX_DRAFT_COLORS,
  emptyDraftInput,
  newColorRow,
  newOptionRow,
} from '@/lib/drafts/empty-draft'

const DRAFT_COLUMNS =
  'id, company_id, brand_id, season_id, draft_no, status, owner, name_ko, name_en, image_url, sample_work_order_url, sample_work_order_name, sample_work_orders, sample_done, order_done, order_in_progress, photo_sample_done, held, hold_reason, held_at, target_cost, cost_currency, cost_confirmed, retail_price, discount_price, origin_country, register_type, open_type, open_type_detail, release_issue, specs, has_options, note, promoted_style_id, created_at, updated_at'

const DRAFT_COLUMNS_LEGACY =
  'id, company_id, brand_id, season_id, draft_no, status, owner, name_ko, name_en, image_url, sample_work_order_url, sample_work_order_name, sample_done, order_done, order_in_progress, photo_sample_done, held, hold_reason, held_at, target_cost, cost_currency, cost_confirmed, retail_price, discount_price, origin_country, register_type, open_type, open_type_detail, release_issue, specs, has_options, note, promoted_style_id, created_at, updated_at'

type DraftRow = {
  id: string
  company_id: string
  brand_id: string | null
  season_id: string | null
  draft_no: string
  status: ProductDraft['status']
  owner: string
  name_ko: string
  name_en: string
  image_url: string | null
  sample_work_order_url: string | null
  sample_work_order_name: string | null
  sample_work_orders: unknown
  sample_done: boolean
  order_done: boolean
  order_in_progress: boolean
  photo_sample_done: boolean
  held: boolean
  hold_reason: string
  held_at: string | null
  target_cost: number | null
  cost_currency: ProductDraft['costCurrency']
  cost_confirmed: boolean
  retail_price: number | null
  discount_price: number | null
  origin_country: string
  register_type: string
  open_type: string
  open_type_detail: string
  release_issue: string
  specs: ProductDraft['specs'] | null
  has_options: boolean
  note: string
  promoted_style_id: string | null
  created_at: string
  updated_at: string
}

type ColorRow = {
  id: string
  draft_id: string
  name: string
  order_qty: number | null
  sample_in_progress: boolean
  sample_work_order_url?: string | null
  sample_work_order_name?: string | null
  sample_work_order_shipped?: boolean
  sample_work_order_shipped_at?: string | null
  sort_order: number
}

const COLOR_COLUMNS =
  'id, draft_id, name, order_qty, sample_in_progress, sample_work_order_url, sample_work_order_name, sample_work_order_shipped, sample_work_order_shipped_at, sort_order'
const COLOR_COLUMNS_LEGACY =
  'id, draft_id, name, order_qty, sample_in_progress, sort_order'

type OptionRow = {
  id: string
  draft_id: string
  style_id: string | null
  name: string
  price: number | null
  sort_order: number
}

const SPEC_KEYS: DraftSpecKey[] = ['size', 'weight', 'fabric', 'coating']

export class ProductDraftStoreError extends Error {
  readonly code: 'not_found' | 'invalid'

  constructor(message: string, code: 'not_found' | 'invalid') {
    super(message)
    this.name = 'ProductDraftStoreError'
    this.code = code
  }
}

function sanitize(input: ProductDraftInput): ProductDraftInput {
  const held = Boolean(input.held)
  const brandId = normalizeDraftBrandId(input.brandId)
  const sampleWorkOrders = sanitizeSampleWorkOrders(input.sampleWorkOrders)
  return {
    ...input,
    brandId,
    seasonId: brandId ? input.seasonId : null,
    owner: input.owner.trim(),
    nameKo: input.nameKo.trim(),
    nameEn: input.nameEn.trim(),
    originCountry: input.originCountry.trim(),
    registerType: input.registerType.trim(),
    openType: input.openType.trim(),
    openTypeDetail: input.openTypeDetail.trim(),
    releaseIssue: input.releaseIssue.trim(),
    note: input.note.trim(),
    holdReason: held ? input.holdReason.trim() : '',
    sampleWorkOrders,
    ...legacyWorkOrderFields(sampleWorkOrders),
    sampleDone: isSamplePassed(sampleWorkOrders),
    orderDone: Boolean(input.orderDone),
    orderInProgress: Boolean(input.orderInProgress),
    colors: input.colors
      .filter(
        (color) =>
          color.name.trim() ||
          color.orderQty != null ||
          Boolean(color.sampleWorkOrderUrl?.trim()),
      )
      .map((color) =>
        sanitizeColorWorkOrder({
          ...color,
          name: color.name.trim(),
        }),
      ),
    options: input.options
      .filter((row) => row.styleId || row.name.trim() || row.price != null)
      .map((row) => ({
        ...row,
        styleId: brandId ? row.styleId : '',
        name: row.name.trim(),
      })),
  }
}

function toJsonValue(value: number | null | undefined) {
  return value == null ? '' : String(value)
}

function buildPayload(input: ProductDraftInput) {
  return {
    seasonId: input.seasonId ?? '',
    status: input.status,
    owner: input.owner,
    nameKo: input.nameKo,
    nameEn: input.nameEn,
    imageUrl: input.imageUrl ?? '',
    sampleWorkOrderUrl: input.sampleWorkOrderUrl ?? '',
    sampleWorkOrderName: input.sampleWorkOrderName,
    sampleWorkOrders: input.sampleWorkOrders,
    sampleDone: input.sampleDone,
    orderDone: input.orderDone,
    orderInProgress: input.orderInProgress,
    photoSampleDone: input.photoSampleDone,
    held: input.held,
    holdReason: input.holdReason,
    heldAt: input.heldAt,
    targetCost: toJsonValue(input.targetCost),
    costCurrency: input.costCurrency,
    costConfirmed: input.costConfirmed,
    retailPrice: toJsonValue(input.retailPrice),
    discountPrice: toJsonValue(input.discountPrice),
    originCountry: input.originCountry,
    registerType: input.registerType,
    openType: input.openType,
    openTypeDetail: input.openTypeDetail,
    releaseIssue: input.releaseIssue,
    specs: input.specs,
    hasOptions: input.hasOptions,
    note: input.note,
  }
}

function normalizeSpecs(raw: ProductDraft['specs'] | null | undefined) {
  const base = emptyDraftInput().specs
  for (const key of SPEC_KEYS) {
    const spec = raw?.[key]
    base[key] = {
      value: spec?.value ?? '',
      confirmed: Boolean(spec?.confirmed),
      note: spec?.note ?? '',
    }
  }
  return base
}

function assemble(
  row: DraftRow,
  colors: DraftColorRow[],
  options: DraftOptionRow[],
): ProductDraft {
  const sampleWorkOrders = normalizeSampleWorkOrders(
    row.sample_work_orders,
    row.sample_work_order_url,
    row.sample_work_order_name ?? '',
  )
  return {
    id: row.id,
    companyId: row.company_id,
    brandId: row.brand_id,
    draftNo: row.draft_no,
    seasonId: row.season_id,
    status: row.status,
    owner: row.owner,
    nameKo: row.name_ko,
    nameEn: row.name_en,
    imageUrl: row.image_url,
    sampleWorkOrders,
    ...legacyWorkOrderFields(sampleWorkOrders),
    colors,
    sampleDone: row.sample_done,
    orderDone: row.order_done,
    orderInProgress: Boolean(row.order_in_progress),
    photoSampleDone: row.photo_sample_done,
    held: row.held,
    holdReason: row.hold_reason,
    heldAt: row.held_at,
    targetCost: row.target_cost,
    costCurrency: row.cost_currency,
    costConfirmed: row.cost_confirmed,
    retailPrice: row.retail_price,
    discountPrice: row.discount_price,
    originCountry: row.origin_country,
    registerType: row.register_type,
    openType: row.open_type,
    openTypeDetail: row.open_type_detail,
    releaseIssue: row.release_issue,
    specs: normalizeSpecs(row.specs),
    hasOptions: row.has_options,
    options,
    note: row.note,
    promotedStyleId: row.promoted_style_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function loadChildren(draftIds: string[]) {
  if (draftIds.length === 0) {
    return {
      colorsByDraft: new Map<string, DraftColorRow[]>(),
      optionsByDraft: new Map<string, DraftOptionRow[]>(),
    }
  }

  const supabase = getSupabase()
  const [colorFirst, optionResult] = await Promise.all([
    supabase
      .from('draft_colors')
      .select(COLOR_COLUMNS)
      .in('draft_id', draftIds)
      .order('sort_order', { ascending: true }),
    supabase
      .from('draft_options')
      .select('id, draft_id, style_id, name, price, sort_order')
      .in('draft_id', draftIds)
      .order('sort_order', { ascending: true }),
  ])
  const colorResult =
    colorFirst.error && isMissingColumn(colorFirst.error)
      ? await supabase
          .from('draft_colors')
          .select(COLOR_COLUMNS_LEGACY)
          .in('draft_id', draftIds)
          .order('sort_order', { ascending: true })
      : colorFirst
  const { data: optionData, error: optionError } = optionResult
  const colorError = colorResult.error
  const colorData = colorResult.data

  if (colorError) {
    throw new ProductDraftStoreError(
      errorMessage(colorError, '기획안 컬러를 불러오지 못했습니다.'),
      'invalid',
    )
  }
  if (optionError) {
    throw new ProductDraftStoreError(
      errorMessage(optionError, '기획안 옵션을 불러오지 못했습니다.'),
      'invalid',
    )
  }

  const colorsByDraft = new Map<string, DraftColorRow[]>()
  for (const row of (colorData as ColorRow[]) ?? []) {
    const list = colorsByDraft.get(row.draft_id) ?? []
    list.push(
      sanitizeColorWorkOrder({
        id: row.id,
        name: row.name,
        orderQty: row.order_qty,
        sampleInProgress: Boolean(row.sample_in_progress),
        sampleWorkOrderUrl: row.sample_work_order_url ?? null,
        sampleWorkOrderName: row.sample_work_order_name ?? '',
        sampleWorkOrderShipped: Boolean(row.sample_work_order_shipped),
        sampleWorkOrderShippedAt: row.sample_work_order_shipped_at ?? null,
      }),
    )
    colorsByDraft.set(row.draft_id, list)
  }

  const optionsByDraft = new Map<string, DraftOptionRow[]>()
  for (const row of (optionData as OptionRow[]) ?? []) {
    const list = optionsByDraft.get(row.draft_id) ?? []
    list.push({
      id: row.id,
      styleId: row.style_id ?? '',
      name: row.name,
      price: row.price,
    })
    optionsByDraft.set(row.draft_id, list)
  }

  return { colorsByDraft, optionsByDraft }
}

async function saveViaRpc(
  companyId: string,
  brandId: string | null,
  id: string | null,
  input: ProductDraftInput,
): Promise<string> {
  const clean = sanitize(input)
  if (!clean.nameKo && !clean.nameEn) {
    throw new ProductDraftStoreError(
      '한글명이나 영문명 중 하나는 입력하세요.',
      'invalid',
    )
  }
  if (clean.status === 'confirmed' && !clean.brandId) {
    throw new ProductDraftStoreError(
      '출시 확정 전에 브랜드를 지정하세요.',
      'invalid',
    )
  }

  const { data, error } = await getSupabase().rpc('save_product_draft', {
    p_company_id: companyId,
    p_brand_id: brandId,
    p_id: id,
    p_payload: buildPayload(clean),
    p_colors: clean.colors.map((color) => ({
      id: color.id,
      name: color.name,
      orderQty: toJsonValue(color.orderQty),
      sampleInProgress: Boolean(color.sampleInProgress),
      sampleWorkOrderUrl: color.sampleWorkOrderUrl ?? '',
      sampleWorkOrderName: color.sampleWorkOrderName,
      sampleWorkOrderShipped: Boolean(color.sampleWorkOrderShipped),
      sampleWorkOrderShippedAt: color.sampleWorkOrderShippedAt ?? '',
    })),
    p_options: clean.options.map((option) => ({
      id: option.id,
      styleId: option.styleId,
      name: option.name,
      price: toJsonValue(option.price),
    })),
  })

  if (error) {
    throw new ProductDraftStoreError(
      errorMessage(error, '기획안을 저장하지 못했습니다.'),
      'invalid',
    )
  }

  return data as string
}

async function selectDraftRows(
  apply: (
    query: ReturnType<ReturnType<typeof getSupabase>['from']>,
    columns: string,
  ) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>,
) {
  const supabase = getSupabase()
  const first = await apply(supabase.from('product_drafts'), DRAFT_COLUMNS)
  if (!first.error) return (first.data as DraftRow[] | DraftRow | null) ?? null
  if (!isMissingColumn(first.error)) {
    throw new ProductDraftStoreError(
      errorMessage(first.error, '기획안을 불러오지 못했습니다.'),
      'invalid',
    )
  }
  const fallback = await apply(supabase.from('product_drafts'), DRAFT_COLUMNS_LEGACY)
  if (fallback.error) {
    throw new ProductDraftStoreError(
      errorMessage(fallback.error, '기획안을 불러오지 못했습니다.'),
      'invalid',
    )
  }
  return (fallback.data as DraftRow[] | DraftRow | null) ?? null
}

export async function listProductDraftsByCompany(
  companyId: string,
): Promise<ProductDraft[]> {
  const data = await selectDraftRows((query, columns) =>
    query.select(columns).eq('company_id', companyId),
  )
  return assembleRows((Array.isArray(data) ? data : data ? [data] : []) as DraftRow[])
}

export async function listProductDrafts(
  brandId: string,
): Promise<ProductDraft[]> {
  const data = await selectDraftRows((query, columns) =>
    query.select(columns).eq('brand_id', brandId),
  )
  return assembleRows((Array.isArray(data) ? data : data ? [data] : []) as DraftRow[])
}

async function assembleRows(rows: DraftRow[]) {
  const { colorsByDraft, optionsByDraft } = await loadChildren(
    rows.map((row) => row.id),
  )

  return rows
    .map((row) =>
      assemble(
        row,
        colorsByDraft.get(row.id) ?? [],
        optionsByDraft.get(row.id) ?? [],
      ),
    )
    .sort((a, b) => parseDraftNo(b.draftNo) - parseDraftNo(a.draftNo))
}

export async function getProductDraftById(
  id: string,
): Promise<ProductDraft | undefined> {
  const data = await selectDraftRows((query, columns) =>
    query.select(columns).eq('id', id).maybeSingle(),
  )
  if (!data || Array.isArray(data)) return undefined

  const row = data as DraftRow
  const { colorsByDraft, optionsByDraft } = await loadChildren([row.id])
  return assemble(
    row,
    colorsByDraft.get(row.id) ?? [],
    optionsByDraft.get(row.id) ?? [],
  )
}

export async function createProductDraft(
  companyId: string,
  input: ProductDraftInput,
): Promise<ProductDraft> {
  const id = await saveViaRpc(companyId, normalizeDraftBrandId(input.brandId), null, input)
  const created = await getProductDraftById(id)
  if (!created) {
    throw new ProductDraftStoreError('기획안을 저장하지 못했습니다.', 'invalid')
  }
  return created
}

export async function updateProductDraft(
  id: string,
  input: ProductDraftInput,
): Promise<ProductDraft> {
  const existing = await getProductDraftById(id)
  if (!existing) {
    throw new ProductDraftStoreError('기획안을 찾을 수 없습니다.', 'not_found')
  }
  await saveViaRpc(
    existing.companyId,
    normalizeDraftBrandId(input.brandId),
    id,
    input,
  )
  const updated = await getProductDraftById(id)
  if (!updated) {
    throw new ProductDraftStoreError('기획안을 저장하지 못했습니다.', 'invalid')
  }
  return updated
}

export async function deleteProductDraft(id: string): Promise<void> {
  const existing = await getProductDraftById(id)
  if (!existing) {
    throw new ProductDraftStoreError('기획안을 찾을 수 없습니다.', 'not_found')
  }
  const { error } = await getSupabase()
    .from('product_drafts')
    .delete()
    .eq('id', id)
  if (error) {
    throw new ProductDraftStoreError(
      errorMessage(error, '기획안을 삭제하지 못했습니다.'),
      'invalid',
    )
  }
}

export async function countProductDraftsBySeason(
  seasonId: string,
): Promise<number> {
  const { count, error } = await getSupabase()
    .from('product_drafts')
    .select('id', { count: 'exact', head: true })
    .eq('season_id', seasonId)
  if (error) {
    throw new ProductDraftStoreError(
      errorMessage(error, '기획안 수를 불러오지 못했습니다.'),
      'invalid',
    )
  }
  return count ?? 0
}
