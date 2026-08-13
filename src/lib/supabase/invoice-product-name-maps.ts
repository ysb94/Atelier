import type { InvoiceProductNameMap, StyleRef } from '@/lib/types'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'

const COLUMNS =
  'id, brand_id, mall_name, normalized_mall_name, product_name, normalized_product_name, item_name_context, normalized_item_name_context, own_product_code, normalized_own_product_code, lookup_key, normalized_lookup_key, style_id, is_active, note, created_at, updated_at'
const SELECT_WITH_STYLE = `${COLUMNS}, styles!invoice_product_name_maps_style_fkey(id, style_no, name)`
const PAGE_SIZE = 1000

type StyleEmbed = {
  id: string
  style_no: string
  name: string
}

type MapRow = {
  id: string
  brand_id: string
  mall_name: string
  normalized_mall_name: string
  product_name: string
  normalized_product_name: string
  item_name_context: string
  normalized_item_name_context: string
  own_product_code: string
  normalized_own_product_code: string
  lookup_key: string
  normalized_lookup_key: string
  style_id: string
  is_active: boolean
  note: string
  created_at: string
  updated_at: string
  styles?: StyleEmbed | StyleEmbed[] | null
}

export class InvoiceProductNameMapStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoiceProductNameMapStoreError'
  }
}

function embedStyle(embed: StyleEmbed | StyleEmbed[] | null | undefined) {
  if (!embed) return null
  return Array.isArray(embed) ? (embed[0] ?? null) : embed
}

function toMap(row: MapRow): InvoiceProductNameMap | null {
  const style = embedStyle(row.styles)
  if (!style) return null
  return {
    id: row.id,
    brandId: row.brand_id,
    mallName: row.mall_name,
    normalizedMallName: row.normalized_mall_name,
    productName: row.product_name,
    normalizedProductName: row.normalized_product_name,
    itemNameContext: row.item_name_context,
    normalizedItemNameContext: row.normalized_item_name_context,
    ownProductCode: row.own_product_code,
    normalizedOwnProductCode: row.normalized_own_product_code,
    lookupKey: row.lookup_key ?? '',
    normalizedLookupKey: row.normalized_lookup_key ?? '',
    style: {
      styleId: style.id,
      styleNo: style.style_no,
      name: style.name,
    },
    isActive: row.is_active,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export type InvoiceProductNameMapInput = {
  mallName?: string
  productName: string
  itemNameContext?: string
  ownProductCode?: string
  /** 기존 원장 조회 키. 채우면 이 문자열 하나로만 매칭한다. */
  lookupKey?: string
  styleId: string
  isActive?: boolean
  note?: string
}

function validateInput(input: InvoiceProductNameMapInput) {
  if (!input.productName.trim()) {
    throw new InvoiceProductNameMapStoreError('원본 품목명을 입력하세요.')
  }
  if (!input.styleId) {
    throw new InvoiceProductNameMapStoreError('본품 M번호를 고르세요.')
  }
}

function payloadFromInput(brandId: string, input: InvoiceProductNameMapInput) {
  const mallName = input.mallName?.trim() ?? ''
  const productName = input.productName.trim()
  const itemNameContext = input.itemNameContext?.trim() ?? ''
  const ownProductCode = input.ownProductCode?.trim() ?? ''
  const lookupKey = input.lookupKey?.trim() ?? ''
  return {
    brand_id: brandId,
    mall_name: mallName,
    normalized_mall_name: normalizeInvoiceText(mallName),
    product_name: productName,
    normalized_product_name: normalizeInvoiceText(productName),
    item_name_context: itemNameContext,
    normalized_item_name_context: normalizeInvoiceText(itemNameContext),
    own_product_code: ownProductCode,
    normalized_own_product_code: normalizeInvoiceText(ownProductCode),
    lookup_key: lookupKey,
    normalized_lookup_key: normalizeInvoiceText(lookupKey),
    style_id: input.styleId,
    is_active: input.isActive ?? true,
    note: input.note?.trim() ?? '',
  }
}

export async function listInvoiceProductNameMaps(
  brandId: string,
  options: { activeOnly?: boolean } = {},
): Promise<InvoiceProductNameMap[]> {
  const supabase = getSupabase()
  const all: InvoiceProductNameMap[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('invoice_product_name_maps')
      .select(SELECT_WITH_STYLE)
      .eq('brand_id', brandId)
      .order('updated_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (options.activeOnly) query = query.eq('is_active', true)
    const { data, error } = await query
    if (error) {
      throw new InvoiceProductNameMapStoreError(
        errorMessage(error, '품목명 변환 기준을 불러오지 못했습니다.'),
      )
    }
    const rows = ((data as MapRow[]) ?? [])
      .map(toMap)
      .filter((item): item is InvoiceProductNameMap => Boolean(item))
    all.push(...rows)
    if ((data ?? []).length < PAGE_SIZE) break
  }
  return all
}

export async function saveInvoiceProductNameMap(
  brandId: string,
  input: InvoiceProductNameMapInput,
  mapId?: string,
): Promise<InvoiceProductNameMap> {
  validateInput(input)
  const supabase = getSupabase()
  const payload = payloadFromInput(brandId, input)

  const finder = supabase
    .from('invoice_product_name_maps')
    .select('id')
    .eq('brand_id', brandId)
  const { data: existing, error: existingError } = payload.normalized_lookup_key
    ? await finder
        .eq('normalized_lookup_key', payload.normalized_lookup_key)
        .maybeSingle()
    : await finder
        .eq('normalized_mall_name', payload.normalized_mall_name)
        .eq('normalized_product_name', payload.normalized_product_name)
        .eq('normalized_item_name_context', payload.normalized_item_name_context)
        .eq('normalized_lookup_key', '')
        .maybeSingle()
  if (existingError) {
    throw new InvoiceProductNameMapStoreError(
      errorMessage(existingError, '품목명 변환 기준을 확인하지 못했습니다.'),
    )
  }

  const targetId = mapId || existing?.id || null
  const writer = targetId
    ? supabase.from('invoice_product_name_maps').update(payload).eq('id', targetId)
    : supabase.from('invoice_product_name_maps').insert(payload)

  const { data, error } = await writer.select(SELECT_WITH_STYLE).single()
  if (error || !data) {
    if (isUniqueViolation(error ?? {})) {
      throw new InvoiceProductNameMapStoreError(
        payload.normalized_lookup_key
          ? '같은 조회 키가 다른 본품으로 이미 있습니다.'
          : '같은 쇼핑몰·품목명·내품명 문맥 조합이 이미 있습니다.',
      )
    }
    throw new InvoiceProductNameMapStoreError(
      errorMessage(error, '품목명 변환 기준을 저장하지 못했습니다.'),
    )
  }
  const mapped = toMap(data as MapRow)
  if (!mapped) {
    throw new InvoiceProductNameMapStoreError(
      '저장한 본품을 불러오지 못했습니다.',
    )
  }
  return mapped
}

export async function setInvoiceProductNameMapActive(
  id: string,
  isActive: boolean,
): Promise<void> {
  const { error } = await getSupabase()
    .from('invoice_product_name_maps')
    .update({ is_active: isActive })
    .eq('id', id)
  if (error) {
    throw new InvoiceProductNameMapStoreError(
      errorMessage(error, '품목명 변환 기준 상태를 바꾸지 못했습니다.'),
    )
  }
}

export async function deleteInvoiceProductNameMap(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from('invoice_product_name_maps')
    .delete()
    .eq('id', id)
  if (error) {
    throw new InvoiceProductNameMapStoreError(
      errorMessage(error, '품목명 변환 기준을 삭제하지 못했습니다.'),
    )
  }
}

export async function applyBulkInvoiceProductNameMaps(
  brandId: string,
  rows: InvoiceProductNameMapInput[],
): Promise<{ saved: number; failures: { index: number; message: string }[] }> {
  let saved = 0
  const failures: { index: number; message: string }[] = []
  for (const [index, input] of rows.entries()) {
    try {
      await saveInvoiceProductNameMap(brandId, input)
      saved += 1
    } catch (reason) {
      failures.push({
        index,
        message:
          reason instanceof Error
            ? reason.message
            : '품목명 변환 기준을 저장하지 못했습니다.',
      })
    }
  }
  return { saved, failures }
}

export type { StyleRef }
