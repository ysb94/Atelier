import type {
  InvoiceProductNameTagRole,
  InvoiceProductNameTagRoleEntry,
} from '@/lib/types'
import {
  RESERVATION_SHIPPING_DATE_FAMILY,
  RESERVATION_SHIPPING_DATE_LABEL,
  isReservationShippingDateTag,
  tagRoleKey,
} from '@/lib/invoice/product-name-tags'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'
import { fetchAllPages } from '@/lib/supabase/paged-select'

const COLUMNS =
  'id, brand_id, tag_text, normalized_tag, role, is_active, note, created_at, updated_at'
const PAGE_SIZE = 1000
const ROLES = new Set<InvoiceProductNameTagRole>([
  'product_composition',
  'event_marketing',
  'composition_gift',
  'identity_condition',
  'unknown',
])

type TagRoleRow = {
  id: string
  brand_id: string
  tag_text: string
  normalized_tag: string
  role: string
  is_active: boolean
  note: string
  created_at: string
  updated_at: string
}

export class InvoiceProductNameTagRoleStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoiceProductNameTagRoleStoreError'
  }
}

export type InvoiceProductNameTagRoleInput = {
  tagText: string
  role: InvoiceProductNameTagRole
  isActive?: boolean
  note?: string
}

function toRole(value: string): InvoiceProductNameTagRole {
  return ROLES.has(value as InvoiceProductNameTagRole)
    ? (value as InvoiceProductNameTagRole)
    : 'unknown'
}

function toEntry(row: TagRoleRow): InvoiceProductNameTagRoleEntry {
  return {
    id: row.id,
    brandId: row.brand_id,
    tagText: row.tag_text,
    normalizedTag: row.normalized_tag,
    role: toRole(row.role),
    isActive: row.is_active,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function validateInput(input: InvoiceProductNameTagRoleInput) {
  if (!input.tagText.trim()) {
    throw new InvoiceProductNameTagRoleStoreError('태그를 입력하세요.')
  }
  if (!ROLES.has(input.role)) {
    throw new InvoiceProductNameTagRoleStoreError('지원하지 않는 태그 역할입니다.')
  }
}

export async function listInvoiceProductNameTagRoles(
  brandId: string,
  options: { activeOnly?: boolean } = {},
): Promise<InvoiceProductNameTagRoleEntry[]> {
  const supabase = getSupabase()
  const rows = await fetchAllPages<TagRoleRow>({
    pageSize: PAGE_SIZE,
    fetchPage: async (from, to, withCount) => {
      let query = supabase
        .from('invoice_product_name_tag_roles')
        .select(COLUMNS, withCount ? { count: 'exact' } : undefined)
        .eq('brand_id', brandId)
        .order('updated_at', { ascending: false })
        .range(from, to)
      if (options.activeOnly) query = query.eq('is_active', true)
      const { data, error, count } = await query
      if (error) {
        throw new InvoiceProductNameTagRoleStoreError(
          errorMessage(error, '품목명 태그 역할을 불러오지 못했습니다.'),
        )
      }
      return { rows: (data as TagRoleRow[]) ?? [], count: count ?? null }
    },
  })
  return rows.map(toEntry)
}

export async function saveInvoiceProductNameTagRole(
  brandId: string,
  input: InvoiceProductNameTagRoleInput,
  roleId?: string,
): Promise<InvoiceProductNameTagRoleEntry> {
  validateInput(input)
  const supabase = getSupabase()
  const tagText = input.tagText.trim()
  const normalizedTag = tagRoleKey(tagText)
  const payload = {
    brand_id: brandId,
    tag_text:
      normalizedTag === RESERVATION_SHIPPING_DATE_FAMILY
        ? RESERVATION_SHIPPING_DATE_LABEL
        : tagText,
    normalized_tag: normalizedTag,
    role: input.role,
    is_active: input.isActive ?? true,
    note: input.note?.trim() ?? '',
  }

  let existingId = roleId
  if (!existingId) {
    const { data: exact, error: exactError } = await supabase
      .from('invoice_product_name_tag_roles')
      .select('id')
      .eq('brand_id', brandId)
      .eq('normalized_tag', payload.normalized_tag)
      .maybeSingle()
    if (exactError) {
      throw new InvoiceProductNameTagRoleStoreError(
        errorMessage(exactError, '품목명 태그 역할을 확인하지 못했습니다.'),
      )
    }
    existingId = exact?.id
  }
  if (!existingId && payload.normalized_tag === RESERVATION_SHIPPING_DATE_FAMILY) {
    const { data: rows, error: listError } = await supabase
      .from('invoice_product_name_tag_roles')
      .select('id, tag_text, normalized_tag')
      .eq('brand_id', brandId)
    if (listError) {
      throw new InvoiceProductNameTagRoleStoreError(
        errorMessage(listError, '품목명 태그 역할을 확인하지 못했습니다.'),
      )
    }
    existingId = ((rows as { id: string; tag_text: string; normalized_tag: string }[]) ?? []).find(
      (row) =>
        isReservationShippingDateTag(row.normalized_tag) ||
        isReservationShippingDateTag(row.tag_text),
    )?.id
  }

  const writer = existingId
    ? supabase
        .from('invoice_product_name_tag_roles')
        .update(payload)
        .eq('id', existingId)
    : supabase.from('invoice_product_name_tag_roles').insert(payload)

  const { data, error } = await writer.select(COLUMNS).single()
  if (error || !data) {
    if (isUniqueViolation(error ?? {})) {
      throw new InvoiceProductNameTagRoleStoreError(
        '같은 태그가 이미 있습니다.',
      )
    }
    throw new InvoiceProductNameTagRoleStoreError(
      errorMessage(error, '품목명 태그 역할을 저장하지 못했습니다.'),
    )
  }
  return toEntry(data as TagRoleRow)
}
