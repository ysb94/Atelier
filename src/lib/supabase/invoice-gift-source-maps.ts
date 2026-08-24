import type {
  InvoiceGiftSourceAllocation,
  InvoiceGiftSourceAssignmentMode,
  InvoiceGiftSourceMap,
  StyleRef,
} from '@/lib/types'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'
import { toAppMoment } from '@/lib/supabase/invoice-prefix-requests'

const MAP_COLUMNS =
  'id, brand_id, mall_name, normalized_mall_name, product_name, normalized_product_name, assignment_mode, unique_per_recipient, is_active, note, created_at, updated_at'
const MAP_SELECT = `${MAP_COLUMNS}, invoice_gift_source_map_products(style_id, sort_order, styles!invoice_gift_source_map_products_style_fkey(id, style_no, name))`
const ALLOCATION_SELECT = `
  id,
  map_id,
  style_id,
  allocation_key,
  order_fingerprint,
  quantity_slot,
  mall_name,
  customer_order_no,
  ordered_at,
  source_file_name,
  created_at,
  styles!invoice_gift_source_allocations_style_fkey(id, style_no, name)
`
const PAGE_SIZE = 1000

type StyleEmbed = {
  id: string
  style_no: string
  name: string
}

type ProductEmbed = {
  style_id: string
  sort_order: number
  styles?: StyleEmbed | StyleEmbed[] | null
}

type MapRow = {
  id: string
  brand_id: string
  mall_name: string
  normalized_mall_name: string
  product_name: string
  normalized_product_name: string
  assignment_mode: InvoiceGiftSourceAssignmentMode
  unique_per_recipient: boolean
  is_active: boolean
  note: string
  created_at: string
  updated_at: string
  invoice_gift_source_map_products?: ProductEmbed[] | null
}

type AllocationRow = {
  id: string
  map_id: string
  style_id: string
  allocation_key: string
  order_fingerprint: string
  quantity_slot: number
  mall_name: string
  customer_order_no: string
  ordered_at: string | null
  source_file_name: string
  created_at: string
  styles?: StyleEmbed | StyleEmbed[] | null
}

export class InvoiceGiftSourceMapStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoiceGiftSourceMapStoreError'
  }
}

function embedStyle(embed: StyleEmbed | StyleEmbed[] | null | undefined) {
  if (!embed) return null
  return Array.isArray(embed) ? (embed[0] ?? null) : embed
}

function toPoolStyles(products: ProductEmbed[] | null | undefined): StyleRef[] {
  return [...(products ?? [])]
    .sort((left, right) => left.sort_order - right.sort_order)
    .flatMap((item) => {
      const style = embedStyle(item.styles)
      if (!style) return []
      return [
        {
          styleId: style.id,
          styleNo: style.style_no,
          name: style.name,
        } satisfies StyleRef,
      ]
    })
}

function toMap(row: MapRow): InvoiceGiftSourceMap {
  return {
    id: row.id,
    brandId: row.brand_id,
    mallName: row.mall_name,
    normalizedMallName: row.normalized_mall_name,
    productName: row.product_name,
    normalizedProductName: row.normalized_product_name,
    assignmentMode: row.assignment_mode,
    uniquePerRecipient: Boolean(row.unique_per_recipient),
    poolStyles: toPoolStyles(row.invoice_gift_source_map_products),
    isActive: row.is_active,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toAllocation(row: AllocationRow): InvoiceGiftSourceAllocation {
  const style = embedStyle(row.styles)
  return {
    id: row.id,
    mapId: row.map_id,
    styleId: style?.id || row.style_id,
    styleNo: style?.style_no ?? '',
    styleName: style?.name ?? '',
    allocationKey: row.allocation_key,
    orderFingerprint: row.order_fingerprint,
    quantitySlot: row.quantity_slot,
    mallName: row.mall_name,
    customerOrderNo: row.customer_order_no,
    orderedAt: row.ordered_at ? toAppMoment(row.ordered_at) : '',
    sourceFileName: row.source_file_name,
    createdAt: row.created_at,
  }
}

export type InvoiceGiftSourceMapInput = {
  mallName: string
  productName: string
  assignmentMode: InvoiceGiftSourceAssignmentMode
  styleIds: string[]
  uniquePerRecipient?: boolean
  isActive?: boolean
  note?: string
}

export type InvoiceGiftSourceAssignRequest = {
  allocationKey: string
  orderFingerprint: string
  quantitySlot: number
  mallName: string
  customerOrderNo: string
  orderedAt: string
  sourceFileName?: string
  uniquenessGroup?: string
}

export type InvoiceGiftSourceAssignResult = {
  allocationKey: string
  styleId: string
  reused: boolean
}

export type InvoiceGiftSourceConfirmRequest = {
  mapId: string
  styleId: string
  allocationKey: string
  orderFingerprint: string
  quantitySlot: number
  mallName: string
  customerOrderNo: string
  orderedAt: string
  sourceFileName?: string
}

function validateInput(input: InvoiceGiftSourceMapInput) {
  if (!input.mallName.trim()) {
    throw new InvoiceGiftSourceMapStoreError('쇼핑몰명을 입력하세요.')
  }
  if (!input.productName.trim()) {
    throw new InvoiceGiftSourceMapStoreError('원본 품목명을 입력하세요.')
  }
  if (input.styleIds.length === 0) {
    throw new InvoiceGiftSourceMapStoreError('후보 M번호를 한 개 이상 고르세요.')
  }
  if (input.assignmentMode === 'fixed' && input.styleIds.length !== 1) {
    throw new InvoiceGiftSourceMapStoreError(
      '고정 배정은 M번호 1개만 고를 수 있습니다.',
    )
  }
}

export async function listInvoiceGiftSourceMaps(
  brandId: string,
  options: { activeOnly?: boolean } = {},
): Promise<InvoiceGiftSourceMap[]> {
  const supabase = getSupabase()
  const all: InvoiceGiftSourceMap[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('invoice_gift_source_maps')
      .select(MAP_SELECT)
      .eq('brand_id', brandId)
      .order('updated_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (options.activeOnly) query = query.eq('is_active', true)
    const { data, error } = await query
    if (error) {
      throw new InvoiceGiftSourceMapStoreError(
        errorMessage(error, '사은품 원본행 매핑을 불러오지 못했습니다.'),
      )
    }
    all.push(...((data as MapRow[]) ?? []).map(toMap))
    if ((data ?? []).length < PAGE_SIZE) break
  }
  return all
}

export async function listInvoiceGiftSourceAllocations(
  brandId: string,
  options: { mapIds?: string[] } = {},
): Promise<InvoiceGiftSourceAllocation[]> {
  if (options.mapIds && options.mapIds.length === 0) return []
  const supabase = getSupabase()
  const all: InvoiceGiftSourceAllocation[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('invoice_gift_source_allocations')
      .select(ALLOCATION_SELECT)
      .eq('brand_id', brandId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (options.mapIds) query = query.in('map_id', options.mapIds)
    const { data, error } = await query
    if (error) {
      throw new InvoiceGiftSourceMapStoreError(
        errorMessage(error, '사은품 원본행 배정을 불러오지 못했습니다.'),
      )
    }
    all.push(...((data as AllocationRow[]) ?? []).map(toAllocation))
    if ((data ?? []).length < PAGE_SIZE) break
  }
  return all
}

export async function saveInvoiceGiftSourceMap(
  brandId: string,
  input: InvoiceGiftSourceMapInput,
  mapId?: string,
): Promise<InvoiceGiftSourceMap> {
  validateInput(input)
  const { data, error } = await getSupabase().rpc('save_invoice_gift_source_map', {
    p_brand_id: brandId,
    p_mall_name: input.mallName.trim(),
    p_normalized_mall_name: normalizeInvoiceText(input.mallName),
    p_product_name: input.productName.trim(),
    p_normalized_product_name: normalizeInvoiceText(input.productName),
    p_assignment_mode: input.assignmentMode,
    p_style_ids: input.styleIds,
    p_is_active: input.isActive ?? true,
    p_note: input.note?.trim() ?? '',
    p_unique_per_recipient: input.uniquePerRecipient ?? false,
    p_map_id: mapId ?? null,
  })
  if (error) {
    throw new InvoiceGiftSourceMapStoreError(
      isUniqueViolation(error)
        ? '같은 쇼핑몰·품목명 매핑이 이미 있습니다.'
        : errorMessage(error, '사은품 원본행 매핑을 저장하지 못했습니다.'),
    )
  }
  const savedId = String(data ?? '')
  const maps = await listInvoiceGiftSourceMaps(brandId)
  const saved = maps.find((item) => item.id === savedId)
  if (!saved) {
    throw new InvoiceGiftSourceMapStoreError(
      '저장한 사은품 원본행 매핑을 다시 읽지 못했습니다.',
    )
  }
  return saved
}

export async function assignInvoiceGiftSourceRows(
  brandId: string,
  mapId: string,
  requests: InvoiceGiftSourceAssignRequest[],
): Promise<InvoiceGiftSourceAssignResult[]> {
  if (requests.length === 0) return []
  const { data, error } = await getSupabase().rpc(
    'assign_invoice_gift_source_rows',
    {
      p_brand_id: brandId,
      p_map_id: mapId,
      p_requests: requests.map((item) => ({
        allocation_key: item.allocationKey,
        order_fingerprint: item.orderFingerprint,
        quantity_slot: item.quantitySlot,
        mall_name: item.mallName,
        customer_order_no: item.customerOrderNo,
        ordered_at: item.orderedAt || null,
        source_file_name: item.sourceFileName ?? '',
        uniqueness_group: item.uniquenessGroup ?? '',
      })),
    },
  )
  if (error) {
    throw new InvoiceGiftSourceMapStoreError(
      errorMessage(error, '사은품 원본행을 배정하지 못했습니다.'),
    )
  }
  return ((data as InvoiceGiftSourceAssignResult[]) ?? []).map((item) => ({
    allocationKey: item.allocationKey ?? (item as { allocation_key?: string }).allocation_key ?? '',
    styleId: item.styleId ?? (item as { style_id?: string }).style_id ?? '',
    reused: Boolean(
      item.reused ?? (item as { reused?: boolean }).reused,
    ),
  }))
}

export async function confirmInvoiceGiftSourceAllocations(
  brandId: string,
  candidates: InvoiceGiftSourceConfirmRequest[],
): Promise<InvoiceGiftSourceAssignResult[]> {
  if (candidates.length === 0) return []
  const { data, error } = await getSupabase().rpc(
    'confirm_invoice_gift_source_allocations',
    {
      p_brand_id: brandId,
      p_candidates: candidates.map((item) => ({
        map_id: item.mapId,
        style_id: item.styleId,
        allocation_key: item.allocationKey,
        order_fingerprint: item.orderFingerprint,
        quantity_slot: item.quantitySlot,
        mall_name: item.mallName,
        customer_order_no: item.customerOrderNo,
        ordered_at: item.orderedAt || null,
        source_file_name: item.sourceFileName ?? '',
      })),
    },
  )
  if (error) {
    throw new InvoiceGiftSourceMapStoreError(
      errorMessage(error, '사은품 원본행 배정을 확정하지 못했습니다.'),
    )
  }
  return ((data as InvoiceGiftSourceAssignResult[]) ?? []).map((item) => ({
    allocationKey:
      item.allocationKey ??
      (item as { allocation_key?: string }).allocation_key ??
      '',
    styleId: item.styleId ?? (item as { style_id?: string }).style_id ?? '',
    reused: Boolean(item.reused ?? (item as { reused?: boolean }).reused),
  }))
}
