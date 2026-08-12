import type {
  InvoicePrefixCountBasis,
  InvoicePrefixItem,
  InvoicePrefixMergeBasis,
  InvoicePrefixRequest,
} from '@/lib/types'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage } from '@/lib/supabase/map-error'

const REQUEST_COLUMNS =
  'id, brand_id, title, task_no, mall_name, normalized_mall_name, starts_at, ends_at, count_basis, merge_basis, is_active, note, created_at, updated_at'
const ITEM_COLUMNS =
  'id, request_id, product_name, normalized_product_name, prefix, outgoing_product_names, is_random'

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
  is_active: boolean
  note: string
  created_at: string
  updated_at: string
  invoice_prefix_items?: InvoicePrefixItemRow[] | null
}

type InvoicePrefixItemRow = {
  id: string
  request_id: string
  product_name: string
  normalized_product_name: string
  prefix: string
  outgoing_product_names: string[] | null
  is_random: boolean
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

function toItem(row: InvoicePrefixItemRow): InvoicePrefixItem {
  return {
    id: row.id,
    requestId: row.request_id,
    productName: row.product_name,
    normalizedProductName: row.normalized_product_name,
    prefix: row.prefix,
    outgoingProductNames: row.outgoing_product_names ?? [],
    isRandom: row.is_random,
  }
}

function toRequest(row: InvoicePrefixRequestRow): InvoicePrefixRequest {
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
    isActive: row.is_active,
    note: row.note,
    items: (row.invoice_prefix_items ?? [])
      .map(toItem)
      .sort((left, right) =>
        left.productName.localeCompare(right.productName, 'ko-KR'),
      ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listInvoicePrefixRequests(
  brandId: string,
): Promise<InvoicePrefixRequest[]> {
  const { data, error } = await getSupabase()
    .from('invoice_prefix_requests')
    .select(`${REQUEST_COLUMNS}, invoice_prefix_items(${ITEM_COLUMNS})`)
    .eq('brand_id', brandId)
    .order('starts_at', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    throw new InvoicePrefixRequestStoreError(
      errorMessage(error, '접두어 요청 건을 불러오지 못했습니다.'),
    )
  }
  return ((data as InvoicePrefixRequestRow[]) ?? []).map(toRequest)
}

export type InvoicePrefixItemInput = {
  productName: string
  prefix: string
  outgoingProductNames: string[]
  isRandom?: boolean
}

export type InvoicePrefixRequestInput = {
  title: string
  taskNo?: string
  mallName: string
  startsAt: string
  endsAt: string
  countBasis?: InvoicePrefixCountBasis
  mergeBasis?: InvoicePrefixMergeBasis
  isActive?: boolean
  note?: string
  items: InvoicePrefixItemInput[]
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
      const seenOutgoing = new Set<string>()
      const outgoingProductNames: string[] = []
      for (const raw of item.outgoingProductNames ?? []) {
        const name = raw.trim()
        if (!name) continue
        const key = normalizeText(name)
        if (seenOutgoing.has(key)) continue
        seenOutgoing.add(key)
        outgoingProductNames.push(name)
      }
      return {
        productName: item.productName.trim(),
        prefix: item.prefix.trim(),
        outgoingProductNames,
        isRandom: Boolean(item.isRandom) && outgoingProductNames.length >= 2,
      }
    })
    .filter((item) => item.productName || item.prefix)

  if (items.length === 0) {
    throw new InvoicePrefixRequestStoreError('접두어 항목을 한 개 이상 넣으세요.')
  }

  const seen = new Set<string>()
  for (const item of items) {
    if (!item.productName) {
      throw new InvoicePrefixRequestStoreError('상품명이 빈 항목이 있습니다.')
    }
    if (!item.prefix) {
      throw new InvoicePrefixRequestStoreError(
        `${item.productName}의 접두어가 비어 있습니다.`,
      )
    }
    if (item.outgoingProductNames.length === 0) {
      throw new InvoicePrefixRequestStoreError(
        `${item.productName}에 나가는 제품을 한 개 이상 고르세요.`,
      )
    }
    if (item.isRandom && item.outgoingProductNames.length < 2) {
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
  }

  return {
    title,
    mallName,
    startsAt,
    endsAt,
    countBasis: parseCountBasis(input.countBasis),
    mergeBasis: parseMergeBasis(input.mergeBasis),
    items,
  }
}

async function replaceItems(
  brandId: string,
  requestId: string,
  items: {
    productName: string
    prefix: string
    outgoingProductNames: string[]
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

  const { error: insertError } = await supabase
    .from('invoice_prefix_items')
    .insert(
      items.map((item) => ({
        brand_id: brandId,
        request_id: requestId,
        product_name: item.productName,
        prefix: item.prefix,
        outgoing_product_names: item.outgoingProductNames,
        is_random: item.isRandom,
      })),
    )

  if (insertError) {
    throw new InvoicePrefixRequestStoreError(
      errorMessage(insertError, '접두어 항목을 저장하지 못했습니다.'),
    )
  }
}

/** 요청 건과 항목을 함께 저장한다. 항목은 넘긴 목록으로 교체한다. */
export async function saveInvoicePrefixRequest(
  brandId: string,
  input: InvoicePrefixRequestInput,
  requestId?: string,
): Promise<InvoicePrefixRequest> {
  const { title, mallName, startsAt, endsAt, countBasis, mergeBasis, items } =
    validate(input)
  const supabase = getSupabase()

  const payload = {
    brand_id: brandId,
    title,
    task_no: input.taskNo?.trim() ?? '',
    mall_name: mallName,
    starts_at: toDbTimestamp(startsAt),
    ends_at: toDbTimestamp(endsAt),
    count_basis: countBasis,
    merge_basis: mergeBasis,
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
  await replaceItems(brandId, saved.id, items)

  const { data: reloaded, error: reloadError } = await supabase
    .from('invoice_prefix_requests')
    .select(`${REQUEST_COLUMNS}, invoice_prefix_items(${ITEM_COLUMNS})`)
    .eq('id', saved.id)
    .single()

  if (reloadError) {
    throw new InvoicePrefixRequestStoreError(
      errorMessage(reloadError, '저장한 요청 건을 다시 읽지 못했습니다.'),
    )
  }
  return toRequest(reloaded as InvoicePrefixRequestRow)
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
