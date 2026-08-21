import type {
  InvoiceGiftLimitMode,
  InvoiceGiftQuota,
  InvoicePrefixCountBasis,
  InvoicePrefixItem,
  InvoicePrefixMergeBasis,
  InvoicePrefixRequest,
  StyleRef,
} from '@/lib/types'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage } from '@/lib/supabase/map-error'

async function countAllocationsForRequest(requestId: string): Promise<number> {
  const { count, error } = await getSupabase()
    .from('invoice_gift_allocations')
    .select('id', { count: 'exact', head: true })
    .eq('request_id', requestId)

  if (error) {
    throw new InvoicePrefixRequestStoreError(
      errorMessage(error, '사은품 배정 건수를 확인하지 못했습니다.'),
    )
  }
  return count ?? 0
}

const REQUEST_COLUMNS =
  'id, brand_id, title, task_no, mall_name, normalized_mall_name, starts_at, ends_at, count_basis, merge_basis, uses_first_come, first_come_limit_mode, first_come_total_limit, is_active, note, created_at, updated_at'
const ITEM_COLUMNS =
  'id, request_id, product_name, normalized_product_name, prefix, is_random'
const PRODUCT_EMBED =
  'invoice_prefix_item_products(style_id, sort_order, styles!invoice_prefix_item_products_style_fkey(id, style_no, name))'
const ITEM_SELECT = `${ITEM_COLUMNS}, ${PRODUCT_EMBED}`
const QUOTA_EMBED =
  'invoice_gift_quotas(id, request_id, style_id, quantity_limit, styles!invoice_gift_quotas_style_fkey(id, style_no, name))'

type StyleEmbed = {
  id: string
  style_no: string
  name: string
}

type ItemProductRow = {
  style_id: string
  sort_order: number
  styles?: StyleEmbed | StyleEmbed[] | null
}

type QuotaRow = {
  id: string
  request_id: string
  style_id: string
  quantity_limit: number
  styles?: StyleEmbed | StyleEmbed[] | null
}

type InvoicePrefixRequestRow = {
  id: string
  brand_id: string
  title: string
  task_no: string
  mall_name: string
  normalized_mall_name: string
  starts_at: string
  ends_at: string
  count_basis: string
  merge_basis: string
  uses_first_come: boolean
  first_come_limit_mode: string
  first_come_total_limit: number | null
  is_active: boolean
  note: string
  created_at: string
  updated_at: string
  invoice_prefix_items?: InvoicePrefixItemRow[] | null
  invoice_gift_quotas?: QuotaRow[] | null
}

type InvoicePrefixItemRow = {
  id: string
  request_id: string
  product_name: string
  normalized_product_name: string
  prefix: string
  is_random: boolean
  invoice_prefix_item_products?: ItemProductRow[] | null
}

export class InvoicePrefixRequestStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoicePrefixRequestStoreError'
  }
}

/**
 * DB timestamp / ISO 문자열을 앱 표준 YYYY-MM-DD HH:MM으로 다듬는다.
 * 시간대가 없는 한국 벽시계라서 Date 변환 없이 문자열만 자른다.
 */
export function toAppMoment(value: string): string {
  const match = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  if (!match) {
    throw new InvoicePrefixRequestStoreError(
      `행사 시각 형식을 읽을 수 없습니다: ${value}`,
    )
  }
  const [, year, month, day, hour, minute] = match
  return `${year}-${month}-${day} ${hour}:${minute}`
}

/** 저장용 YYYY-MM-DD HH:MM:00. datetime-local의 T도 받는다. */
export function toDbTimestamp(value: string): string {
  return `${toAppMoment(value)}:00`
}

function parseCountBasis(value: string | null | undefined): InvoicePrefixCountBasis {
  if (value === 'per_product' || value === 'per_quantity' || value === 'per_order') {
    return value
  }
  return 'per_order'
}

function parseMergeBasis(value: string | null | undefined): InvoicePrefixMergeBasis {
  if (value === 'per_shipment' || value === 'per_order') return value
  return 'per_order'
}

function parseLimitMode(
  value: string | null | undefined,
): InvoiceGiftLimitMode {
  return value === 'shared_total' ? 'shared_total' : 'per_style'
}

function styleFromEmbed(embed: StyleEmbed | StyleEmbed[] | null | undefined): StyleEmbed | null {
  if (!embed) return null
  return Array.isArray(embed) ? (embed[0] ?? null) : embed
}

function toOutgoingProducts(rows: ItemProductRow[] | null | undefined): StyleRef[] {
  return [...(rows ?? [])]
    .sort((left, right) => left.sort_order - right.sort_order)
    .flatMap((row) => {
      const style = styleFromEmbed(row.styles)
      if (!style) return []
      return [
        {
          styleId: style.id || row.style_id,
          styleNo: style.style_no,
          name: style.name,
        },
      ]
    })
}

function toItem(row: InvoicePrefixItemRow): InvoicePrefixItem {
  return {
    id: row.id,
    requestId: row.request_id,
    productName: row.product_name,
    normalizedProductName: row.normalized_product_name,
    prefix: row.prefix,
    outgoingProducts: toOutgoingProducts(row.invoice_prefix_item_products),
    isRandom: row.is_random,
  }
}

function toQuota(
  row: QuotaRow,
  usedByStyle: Map<string, number>,
): InvoiceGiftQuota {
  const style = styleFromEmbed(row.styles)
  const usedCount = usedByStyle.get(row.style_id) ?? 0
  const quantityLimit = row.quantity_limit
  return {
    id: row.id,
    requestId: row.request_id,
    styleId: style?.id || row.style_id,
    styleNo: style?.style_no ?? '',
    styleName: style?.name ?? '',
    quantityLimit,
    usedCount,
    remainingCount: Math.max(0, quantityLimit - usedCount),
  }
}

function toRequest(
  row: InvoicePrefixRequestRow,
  usage: RequestUsage = {
    totalCount: 0,
    historyCount: 0,
    byStyle: new Map(),
  },
): InvoicePrefixRequest {
  return {
    id: row.id,
    brandId: row.brand_id,
    title: row.title,
    taskNo: row.task_no,
    mallName: row.mall_name,
    normalizedMallName: row.normalized_mall_name,
    startsAt: toAppMoment(row.starts_at),
    endsAt: toAppMoment(row.ends_at),
    countBasis: parseCountBasis(row.count_basis),
    mergeBasis: parseMergeBasis(row.merge_basis),
    usesFirstCome: Boolean(row.uses_first_come),
    firstComeLimitMode: parseLimitMode(row.first_come_limit_mode),
    firstComeTotalLimit:
      row.first_come_total_limit === null
        ? null
        : Number(row.first_come_total_limit),
    firstComeUsedCount: usage.totalCount,
    hasAllocationHistory: usage.historyCount > 0,
    isActive: row.is_active,
    note: row.note,
    items: (row.invoice_prefix_items ?? [])
      .map(toItem)
      .sort((left, right) =>
        left.productName.localeCompare(right.productName, 'ko-KR'),
      ),
    quotas: (row.invoice_gift_quotas ?? [])
      .map((quota) => toQuota(quota, usage.byStyle))
      .sort(
        (left, right) =>
          left.styleNo.localeCompare(right.styleNo, 'ko-KR') ||
          left.styleName.localeCompare(right.styleName, 'ko-KR'),
      ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

type RequestUsage = {
  totalCount: number
  historyCount: number
  byStyle: Map<string, number>
}

async function loadActiveUsageByRequest(
  brandId: string,
): Promise<Map<string, RequestUsage>> {
  const { data, error } = await getSupabase()
    .from('invoice_gift_allocations')
    .select('request_id, style_id, cancelled_at')
    .eq('brand_id', brandId)

  if (error) {
    throw new InvoicePrefixRequestStoreError(
      errorMessage(error, '사은품 배정 사용량을 불러오지 못했습니다.'),
    )
  }

  const byRequest = new Map<string, RequestUsage>()
  for (const row of (data as {
    request_id: string
    style_id: string
    cancelled_at: string | null
  }[]) ?? []) {
    const usage = byRequest.get(row.request_id) ?? {
      totalCount: 0,
      historyCount: 0,
      byStyle: new Map<string, number>(),
    }
    usage.historyCount += 1
    if (row.cancelled_at) {
      byRequest.set(row.request_id, usage)
      continue
    }
    usage.totalCount += 1
    usage.byStyle.set(
      row.style_id,
      (usage.byStyle.get(row.style_id) ?? 0) + 1,
    )
    byRequest.set(row.request_id, usage)
  }
  return byRequest
}

const REQUEST_PAGE_SIZE = 1000

export async function listInvoicePrefixRequests(
  brandId: string,
): Promise<InvoicePrefixRequest[]> {
  const loadRows = async () => {
    const all: InvoicePrefixRequestRow[] = []
    for (let from = 0; ; from += REQUEST_PAGE_SIZE) {
      const { data, error } = await getSupabase()
        .from('invoice_prefix_requests')
        .select(
          `${REQUEST_COLUMNS}, invoice_prefix_items(${ITEM_SELECT}), ${QUOTA_EMBED}`,
        )
        .eq('brand_id', brandId)
        .order('starts_at', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, from + REQUEST_PAGE_SIZE - 1)

      if (error) {
        throw new InvoicePrefixRequestStoreError(
          errorMessage(error, '접두어 요청 건을 불러오지 못했습니다.'),
        )
      }
      const rows = (data as InvoicePrefixRequestRow[]) ?? []
      all.push(...rows)
      if (rows.length < REQUEST_PAGE_SIZE) break
    }
    return all
  }
  const [rows, usageByRequest] = await Promise.all([
    loadRows(),
    loadActiveUsageByRequest(brandId),
  ])
  return rows.map((row) => toRequest(row, usageByRequest.get(row.id)))
}

export type InvoicePrefixItemInput = {
  productName: string
  /** @deprecated 저장하지 않음 */
  prefix?: string
  outgoingStyleIds: string[]
  isRandom?: boolean
}

export type InvoiceGiftQuotaInput = {
  styleId: string
  quantityLimit: number
}

export type InvoicePrefixRequestInput = {
  title: string
  taskNo?: string
  mallName: string
  startsAt: string
  endsAt: string
  countBasis?: InvoicePrefixCountBasis
  mergeBasis?: InvoicePrefixMergeBasis
  usesFirstCome?: boolean
  firstComeLimitMode?: InvoiceGiftLimitMode
  firstComeTotalLimit?: number | null
  isActive?: boolean
  note?: string
  items: InvoicePrefixItemInput[]
  quotas?: InvoiceGiftQuotaInput[]
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR')
}

function validate(input: InvoicePrefixRequestInput) {
  const title = input.title.trim()
  const mallName = input.mallName.trim()

  if (!title) throw new InvoicePrefixRequestStoreError('제목을 입력하세요.')
  if (!mallName) {
    throw new InvoicePrefixRequestStoreError('쇼핑몰명을 입력하세요.')
  }
  if (!input.startsAt.trim() || !input.endsAt.trim()) {
    throw new InvoicePrefixRequestStoreError('행사 기간을 입력하세요.')
  }

  const startsAt = toAppMoment(input.startsAt)
  const endsAt = toAppMoment(input.endsAt)
  if (endsAt < startsAt) {
    throw new InvoicePrefixRequestStoreError(
      '종료 시각이 시작 시각보다 앞설 수 없습니다.',
    )
  }

  const items = input.items
    .map((item) => {
      const seen = new Set<string>()
      const outgoingStyleIds: string[] = []
      for (const raw of item.outgoingStyleIds ?? []) {
        const styleId = raw.trim()
        if (!styleId || seen.has(styleId)) continue
        seen.add(styleId)
        outgoingStyleIds.push(styleId)
      }
      return {
        productName: item.productName.trim(),
        prefix: '',
        outgoingStyleIds,
        isRandom: Boolean(item.isRandom) && outgoingStyleIds.length >= 2,
      }
    })
    .filter((item) => item.productName)

  if (items.length === 0) {
    throw new InvoicePrefixRequestStoreError('접두어 항목을 한 개 이상 넣으세요.')
  }

  const seen = new Set<string>()
  const outgoingStyleIds = new Set<string>()
  for (const item of items) {
    if (!item.productName) {
      throw new InvoicePrefixRequestStoreError('상품명이 빈 항목이 있습니다.')
    }
    if (item.outgoingStyleIds.length === 0) {
      throw new InvoicePrefixRequestStoreError(
        `${item.productName}에 나가는 제품을 한 개 이상 고르세요.`,
      )
    }
    if (item.isRandom && item.outgoingStyleIds.length < 2) {
      throw new InvoicePrefixRequestStoreError(
        `${item.productName}의 랜덤 출고는 나가는 제품이 2개 이상일 때만 켤 수 있습니다.`,
      )
    }
    const key = normalizeText(item.productName)
    if (seen.has(key)) {
      throw new InvoicePrefixRequestStoreError(
        `같은 요청 건에 상품명이 중복됩니다: ${item.productName}`,
      )
    }
    seen.add(key)
    for (const styleId of item.outgoingStyleIds) {
      outgoingStyleIds.add(styleId)
    }
  }

  const usesFirstCome = Boolean(input.usesFirstCome)
  const firstComeLimitMode = parseLimitMode(input.firstComeLimitMode)
  const quotas = (input.quotas ?? [])
    .map((quota) => ({
      styleId: quota.styleId.trim(),
      quantityLimit: Math.floor(Number(quota.quantityLimit)),
    }))
    .filter((quota) => quota.styleId)

  let firstComeTotalLimit: number | null = null
  if (usesFirstCome && firstComeLimitMode === 'shared_total') {
    const parsed = Math.floor(Number(input.firstComeTotalLimit))
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new InvoicePrefixRequestStoreError(
        '전체 합계 선착순 수량은 1 이상 정수여야 합니다.',
      )
    }
    firstComeTotalLimit = parsed
  } else if (usesFirstCome) {
    if (quotas.length === 0) {
      throw new InvoicePrefixRequestStoreError(
        '선착순을 쓰려면 M번호별 행사 배정수량을 입력하세요.',
      )
    }
    const quotaSeen = new Set<string>()
    for (const quota of quotas) {
      if (!outgoingStyleIds.has(quota.styleId)) {
        throw new InvoicePrefixRequestStoreError(
          '나가는 제품에 없는 M번호에는 선착순 수량을 둘 수 없습니다.',
        )
      }
      if (!Number.isFinite(quota.quantityLimit) || quota.quantityLimit < 1) {
        throw new InvoicePrefixRequestStoreError(
          '선착순 수량은 1 이상 정수여야 합니다.',
        )
      }
      if (quotaSeen.has(quota.styleId)) {
        throw new InvoicePrefixRequestStoreError(
          '같은 M번호의 선착순 수량이 중복됩니다.',
        )
      }
      quotaSeen.add(quota.styleId)
    }
    for (const styleId of outgoingStyleIds) {
      if (!quotaSeen.has(styleId)) {
        throw new InvoicePrefixRequestStoreError(
          '나가는 모든 M번호에 선착순 수량을 입력하세요.',
        )
      }
    }
  }

  return {
    title,
    mallName,
    startsAt,
    endsAt,
    countBasis: parseCountBasis(input.countBasis),
    mergeBasis: parseMergeBasis(input.mergeBasis),
    usesFirstCome,
    firstComeLimitMode: usesFirstCome ? firstComeLimitMode : 'per_style',
    firstComeTotalLimit,
    quotas:
      usesFirstCome && firstComeLimitMode === 'per_style' ? quotas : [],
    items,
  }
}

async function replaceItems(
  brandId: string,
  requestId: string,
  items: {
    productName: string
    prefix: string
    outgoingStyleIds: string[]
    isRandom: boolean
  }[],
) {
  const supabase = getSupabase()
  const { error: deleteError } = await supabase
    .from('invoice_prefix_items')
    .delete()
    .eq('request_id', requestId)

  if (deleteError) {
    throw new InvoicePrefixRequestStoreError(
      errorMessage(deleteError, '기존 접두어 항목을 정리하지 못했습니다.'),
    )
  }

  if (items.length === 0) return

  const { data: inserted, error: insertError } = await supabase
    .from('invoice_prefix_items')
    .insert(
      items.map((item) => ({
        brand_id: brandId,
        request_id: requestId,
        product_name: item.productName,
        prefix: '',
        outgoing_product_names: [],
        is_random: item.isRandom,
      })),
    )
    .select('id, product_name')

  if (insertError) {
    throw new InvoicePrefixRequestStoreError(
      errorMessage(insertError, '접두어 항목을 저장하지 못했습니다.'),
    )
  }

  const productRows: {
    brand_id: string
    item_id: string
    style_id: string
    sort_order: number
  }[] = []

  const insertedRows = (inserted as { id: string; product_name: string }[]) ?? []
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!
    const saved = insertedRows.find(
      (row) => row.product_name === item.productName,
    ) ?? insertedRows[index]
    if (!saved) {
      throw new InvoicePrefixRequestStoreError(
        '저장한 접두어 항목 id를 찾지 못했습니다.',
      )
    }
    item.outgoingStyleIds.forEach((styleId, sortOrder) => {
      productRows.push({
        brand_id: brandId,
        item_id: saved.id,
        style_id: styleId,
        sort_order: sortOrder,
      })
    })
  }

  if (productRows.length === 0) return

  const { error: productError } = await supabase
    .from('invoice_prefix_item_products')
    .insert(productRows)

  if (productError) {
    throw new InvoicePrefixRequestStoreError(
      errorMessage(productError, '나가는 제품을 저장하지 못했습니다.'),
    )
  }
}

async function replaceQuotas(
  brandId: string,
  requestId: string,
  quotas: { styleId: string; quantityLimit: number }[],
) {
  const supabase = getSupabase()
  const { error: deleteError } = await supabase
    .from('invoice_gift_quotas')
    .delete()
    .eq('request_id', requestId)

  if (deleteError) {
    throw new InvoicePrefixRequestStoreError(
      errorMessage(deleteError, '기존 선착순 수량을 정리하지 못했습니다.'),
    )
  }

  if (quotas.length === 0) return

  const { error: insertError } = await supabase.from('invoice_gift_quotas').insert(
    quotas.map((quota) => ({
      brand_id: brandId,
      request_id: requestId,
      style_id: quota.styleId,
      quantity_limit: quota.quantityLimit,
    })),
  )

  if (insertError) {
    throw new InvoicePrefixRequestStoreError(
      errorMessage(insertError, '선착순 수량을 저장하지 못했습니다.'),
    )
  }
}

async function updateExistingQuotas(
  requestId: string,
  quotas: { styleId: string; quantityLimit: number }[],
) {
  for (const quota of quotas) {
    const { data, error } = await getSupabase()
      .from('invoice_gift_quotas')
      .update({ quantity_limit: quota.quantityLimit })
      .eq('request_id', requestId)
      .eq('style_id', quota.styleId)
      .select('id')

    if (error || !data || data.length !== 1) {
      throw new InvoicePrefixRequestStoreError(
        errorMessage(error, 'M번호별 선착순 한도를 늘리지 못했습니다.'),
      )
    }
  }
}

/** 요청 건과 항목을 함께 저장한다. 항목은 넘긴 목록으로 교체한다. */
export async function saveInvoicePrefixRequest(
  brandId: string,
  input: InvoicePrefixRequestInput,
  requestId?: string,
): Promise<InvoicePrefixRequest> {
  const {
    title,
    mallName,
    startsAt,
    endsAt,
    countBasis,
    mergeBasis,
    usesFirstCome,
    firstComeLimitMode,
    firstComeTotalLimit,
    quotas,
    items,
  } = validate(input)
  const supabase = getSupabase()
  let allocationCount = 0

  if (requestId) {
    allocationCount = await countAllocationsForRequest(requestId)
    if (allocationCount > 0) {
      // 배정 이력이 있으면 구조 변경 없이 메타·한도 증가만 허용한다.
      const { data: current, error: currentError } = await supabase
        .from('invoice_prefix_requests')
        .select(
          `${REQUEST_COLUMNS}, invoice_prefix_items(${ITEM_SELECT}), ${QUOTA_EMBED}`,
        )
        .eq('id', requestId)
        .single()

      if (currentError) {
        throw new InvoicePrefixRequestStoreError(
          errorMessage(currentError, '기존 요청 건을 읽지 못했습니다.'),
        )
      }

      const existing = toRequest(current as InvoicePrefixRequestRow)
      const sameItems =
        existing.items.length === items.length &&
        existing.items.every((item, index) => {
          const next = items[index]
          if (!next) return false
          const nextIds = [...next.outgoingStyleIds].sort().join(',')
          const prevIds = item.outgoingProducts
            .map((ref) => ref.styleId)
            .sort()
            .join(',')
          return (
            normalizeText(item.productName) ===
              normalizeText(next.productName) &&
            item.isRandom === next.isRandom &&
            prevIds === nextIds
          )
        })

      if (!sameItems) {
        throw new InvoicePrefixRequestStoreError(
          '이미 배정된 요청 건은 대상 품목·나가는 제품을 바꿀 수 없습니다. 중지하세요.',
        )
      }

      const sameRequestStructure =
        existing.taskNo === (input.taskNo?.trim() ?? '') &&
        existing.mallName === mallName &&
        existing.startsAt === startsAt &&
        existing.endsAt === endsAt &&
        existing.countBasis === countBasis &&
        existing.mergeBasis === mergeBasis &&
        existing.usesFirstCome === usesFirstCome &&
        existing.firstComeLimitMode === firstComeLimitMode
      if (!sameRequestStructure) {
        throw new InvoicePrefixRequestStoreError(
          '이미 배정된 요청 건은 제목·메모·활성 상태와 한도 증가만 변경할 수 있습니다.',
        )
      }

      if (firstComeLimitMode === 'shared_total') {
        if (
          firstComeTotalLimit === null ||
          existing.firstComeTotalLimit === null ||
          firstComeTotalLimit < existing.firstComeTotalLimit
        ) {
          throw new InvoicePrefixRequestStoreError(
            '이미 배정된 전체 합계 선착순 한도는 줄일 수 없습니다.',
          )
        }
      } else {
        const sameQuotaStyles =
          existing.quotas.length === quotas.length &&
          existing.quotas.every((current) => {
            const next = quotas.find(
              (quota) => quota.styleId === current.styleId,
            )
            return Boolean(next && next.quantityLimit >= current.quantityLimit)
          })
        if (!sameQuotaStyles) {
          throw new InvoicePrefixRequestStoreError(
            '이미 배정된 M번호별 선착순 한도는 구성하거나 줄일 수 없습니다.',
          )
        }
      }
    }
  }

  const payload = {
    brand_id: brandId,
    title,
    task_no: input.taskNo?.trim() ?? '',
    mall_name: mallName,
    starts_at: toDbTimestamp(startsAt),
    ends_at: toDbTimestamp(endsAt),
    count_basis: countBasis,
    merge_basis: mergeBasis,
    uses_first_come: usesFirstCome,
    first_come_limit_mode: firstComeLimitMode,
    first_come_total_limit: firstComeTotalLimit,
    is_active: input.isActive ?? true,
    note: input.note?.trim() ?? '',
  }

  const query = requestId
    ? supabase
        .from('invoice_prefix_requests')
        .update(payload)
        .eq('id', requestId)
    : supabase.from('invoice_prefix_requests').insert(payload)
  const { data, error } = await query.select(REQUEST_COLUMNS).single()

  if (error) {
    throw new InvoicePrefixRequestStoreError(
      errorMessage(error, '접두어 요청 건을 저장하지 못했습니다.'),
    )
  }

  const saved = data as InvoicePrefixRequestRow

  if (allocationCount === 0) {
    await replaceItems(brandId, saved.id, items)
    await replaceQuotas(brandId, saved.id, quotas)
  } else if (firstComeLimitMode === 'per_style') {
    await updateExistingQuotas(saved.id, quotas)
  }

  const { data: reloaded, error: reloadError } = await supabase
    .from('invoice_prefix_requests')
    .select(
      `${REQUEST_COLUMNS}, invoice_prefix_items(${ITEM_SELECT}), ${QUOTA_EMBED}`,
    )
    .eq('id', saved.id)
    .single()

  if (reloadError) {
    throw new InvoicePrefixRequestStoreError(
      errorMessage(reloadError, '저장한 요청 건을 다시 읽지 못했습니다.'),
    )
  }

  const usage = await loadActiveUsageByRequest(brandId)
  return toRequest(
    reloaded as InvoicePrefixRequestRow,
    usage.get(saved.id),
  )
}

export async function setInvoicePrefixRequestActive(
  id: string,
  isActive: boolean,
): Promise<void> {
  const { error } = await getSupabase()
    .from('invoice_prefix_requests')
    .update({ is_active: isActive })
    .eq('id', id)

  if (error) {
    throw new InvoicePrefixRequestStoreError(
      errorMessage(error, '요청 건 상태를 바꾸지 못했습니다.'),
    )
  }
}

export async function deleteInvoicePrefixRequest(id: string): Promise<void> {
  const allocationCount = await countAllocationsForRequest(id)
  if (allocationCount > 0) {
    throw new InvoicePrefixRequestStoreError(
      '배정 이력이 있는 요청 건은 삭제할 수 없습니다. 중지하세요.',
    )
  }

  const { error } = await getSupabase()
    .from('invoice_prefix_requests')
    .delete()
    .eq('id', id)

  if (error) {
    throw new InvoicePrefixRequestStoreError(
      errorMessage(error, '요청 건을 삭제하지 못했습니다.'),
    )
  }
}
