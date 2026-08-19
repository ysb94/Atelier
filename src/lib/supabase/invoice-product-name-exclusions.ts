import type { InvoiceProductNameExclusion } from '@/lib/types'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'

const COLUMNS =
  'id, brand_id, mall_name, normalized_mall_name, product_name, normalized_product_name, item_name, normalized_item_name, is_active, note, created_at, updated_at'
const PAGE_SIZE = 1000

type ExclusionRow = {
  id: string
  brand_id: string
  mall_name: string
  normalized_mall_name: string
  product_name: string
  normalized_product_name: string
  item_name: string
  normalized_item_name: string
  is_active: boolean
  note: string
  created_at: string
  updated_at: string
}

export class InvoiceProductNameExclusionStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoiceProductNameExclusionStoreError'
  }
}

function toExclusion(row: ExclusionRow): InvoiceProductNameExclusion {
  return {
    id: row.id,
    brandId: row.brand_id,
    mallName: row.mall_name,
    normalizedMallName: row.normalized_mall_name,
    productName: row.product_name,
    normalizedProductName: row.normalized_product_name,
    itemName: row.item_name,
    normalizedItemName: row.normalized_item_name,
    isActive: row.is_active,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export type InvoiceProductNameExclusionInput = {
  mallName: string
  productName: string
  itemName: string
  isActive?: boolean
  note?: string
}

function validateInput(input: InvoiceProductNameExclusionInput) {
  if (!input.mallName.trim()) {
    throw new InvoiceProductNameExclusionStoreError(
      '쇼핑몰명을 입력하세요. 모든 쇼핑몰 규칙은 둘 수 없습니다.',
    )
  }
  if (!input.productName.trim()) {
    throw new InvoiceProductNameExclusionStoreError('원본 품목명을 입력하세요.')
  }
  if (!input.itemName.trim()) {
    throw new InvoiceProductNameExclusionStoreError('원본 내품명을 입력하세요.')
  }
}

function payloadFromInput(
  brandId: string,
  input: InvoiceProductNameExclusionInput,
) {
  const mallName = input.mallName.trim()
  const productName = input.productName.trim()
  const itemName = input.itemName.trim()
  return {
    brand_id: brandId,
    mall_name: mallName,
    normalized_mall_name: normalizeInvoiceText(mallName),
    product_name: productName,
    normalized_product_name: normalizeInvoiceText(productName),
    item_name: itemName,
    normalized_item_name: normalizeInvoiceText(itemName),
    is_active: input.isActive ?? true,
    note: input.note?.trim() ?? '',
  }
}

export async function listInvoiceProductNameExclusions(
  brandId: string,
  options: { activeOnly?: boolean } = {},
): Promise<InvoiceProductNameExclusion[]> {
  const supabase = getSupabase()
  const all: InvoiceProductNameExclusion[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('invoice_product_name_exclusions')
      .select(COLUMNS)
      .eq('brand_id', brandId)
      .order('updated_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (options.activeOnly) query = query.eq('is_active', true)
    const { data, error } = await query
    if (error) {
      throw new InvoiceProductNameExclusionStoreError(
        errorMessage(error, '송장 제외 기준을 불러오지 못했습니다.'),
      )
    }
    all.push(...((data as ExclusionRow[]) ?? []).map(toExclusion))
    if ((data ?? []).length < PAGE_SIZE) break
  }
  return all
}

export async function saveInvoiceProductNameExclusion(
  brandId: string,
  input: InvoiceProductNameExclusionInput,
  exclusionId?: string,
): Promise<InvoiceProductNameExclusion> {
  validateInput(input)
  const supabase = getSupabase()
  const payload = payloadFromInput(brandId, input)

  const { data: existing, error: existingError } = await supabase
    .from('invoice_product_name_exclusions')
    .select('id')
    .eq('brand_id', brandId)
    .eq('normalized_mall_name', payload.normalized_mall_name)
    .eq('normalized_product_name', payload.normalized_product_name)
    .eq('normalized_item_name', payload.normalized_item_name)
    .maybeSingle()
  if (existingError) {
    throw new InvoiceProductNameExclusionStoreError(
      errorMessage(existingError, '송장 제외 기준을 확인하지 못했습니다.'),
    )
  }

  const targetId = exclusionId || existing?.id || null
  const query = targetId
    ? supabase
        .from('invoice_product_name_exclusions')
        .update(payload)
        .eq('id', targetId)
        .eq('brand_id', brandId)
        .select(COLUMNS)
        .single()
    : supabase
        .from('invoice_product_name_exclusions')
        .insert(payload)
        .select(COLUMNS)
        .single()

  const { data, error } = await query
  if (error || !data) {
    if (isUniqueViolation(error ?? {})) {
      throw new InvoiceProductNameExclusionStoreError(
        '같은 쇼핑몰·품목명·내품명 제외 기준이 이미 있습니다.',
      )
    }
    throw new InvoiceProductNameExclusionStoreError(
      errorMessage(error, '송장 제외 기준을 저장하지 못했습니다.'),
    )
  }
  return toExclusion(data as ExclusionRow)
}

export async function setInvoiceProductNameExclusionActive(
  id: string,
  isActive: boolean,
): Promise<void> {
  const { error } = await getSupabase()
    .from('invoice_product_name_exclusions')
    .update({ is_active: isActive })
    .eq('id', id)
  if (error) {
    throw new InvoiceProductNameExclusionStoreError(
      errorMessage(error, '송장 제외 기준 상태를 바꾸지 못했습니다.'),
    )
  }
}

export async function deleteInvoiceProductNameExclusion(
  id: string,
): Promise<void> {
  const { data, error } = await getSupabase()
    .from('invoice_product_name_exclusions')
    .delete()
    .eq('id', id)
    .select('id')
  if (error) {
    throw new InvoiceProductNameExclusionStoreError(
      errorMessage(error, '송장 제외 기준을 삭제하지 못했습니다.'),
    )
  }
  if (!data?.length) {
    throw new InvoiceProductNameExclusionStoreError(
      '삭제할 기준을 찾지 못했거나 권한이 없습니다.',
    )
  }
}
