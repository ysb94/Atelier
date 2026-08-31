import type { InvoiceDiscontinuedStyle } from '@/lib/types'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'
import { fetchAllPages } from '@/lib/supabase/paged-select'

const COLUMNS = 'id, brand_id, style_id, note, created_at, updated_at'
const STYLE_EMBED =
  'styles!invoice_discontinued_styles_style_fkey(id, style_no, name)'
const SELECT = `${COLUMNS}, ${STYLE_EMBED}`
const PAGE_SIZE = 1000

type StyleEmbed = {
  id: string
  style_no: string
  name: string
}

type Row = {
  id: string
  brand_id: string
  style_id: string
  note: string
  created_at: string
  updated_at: string
  styles?: StyleEmbed | StyleEmbed[] | null
}

export class InvoiceDiscontinuedStyleStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoiceDiscontinuedStyleStoreError'
  }
}

export type InvoiceDiscontinuedStyleInput = {
  styleId: string
  note?: string
}

function styleFromEmbed(
  embed: StyleEmbed | StyleEmbed[] | null | undefined,
): { styleId: string; styleNo: string; name: string } | null {
  if (!embed) return null
  const row = Array.isArray(embed) ? (embed[0] ?? null) : embed
  if (!row) return null
  return { styleId: row.id, styleNo: row.style_no, name: row.name }
}

function toItem(row: Row): InvoiceDiscontinuedStyle {
  const style = styleFromEmbed(row.styles)
  return {
    id: row.id,
    brandId: row.brand_id,
    styleId: row.style_id,
    styleNo: style?.styleNo ?? '',
    name: style?.name ?? '',
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listInvoiceDiscontinuedStyles(
  brandId: string,
): Promise<InvoiceDiscontinuedStyle[]> {
  const supabase = getSupabase()
  const rows = await fetchAllPages<Row>({
    pageSize: PAGE_SIZE,
    fetchPage: async (from, to, withCount) => {
      const { data, error, count } = await supabase
        .from('invoice_discontinued_styles')
        .select(SELECT, withCount ? { count: 'exact' } : undefined)
        .eq('brand_id', brandId)
        .order('created_at', { ascending: false })
        .range(from, to)
      if (error) {
        throw new InvoiceDiscontinuedStyleStoreError(
          errorMessage(error, '단종 리스트를 불러오지 못했습니다.'),
        )
      }
      return { rows: (data as Row[]) ?? [], count: count ?? null }
    },
  })
  return rows.map(toItem)
}

export async function createInvoiceDiscontinuedStyle(
  brandId: string,
  input: InvoiceDiscontinuedStyleInput,
): Promise<InvoiceDiscontinuedStyle> {
  if (!input.styleId.trim()) {
    throw new InvoiceDiscontinuedStyleStoreError('단종 상품을 선택하세요.')
  }
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('invoice_discontinued_styles')
    .insert({
      brand_id: brandId,
      style_id: input.styleId.trim(),
      note: input.note?.trim() ?? '',
    })
    .select(SELECT)
    .single()
  if (error || !data) {
    if (isUniqueViolation(error ?? {})) {
      throw new InvoiceDiscontinuedStyleStoreError(
        '이미 단종 리스트에 있는 상품입니다.',
      )
    }
    throw new InvoiceDiscontinuedStyleStoreError(
      errorMessage(error, '단종 리스트에 추가하지 못했습니다.'),
    )
  }
  return toItem(data as Row)
}

export async function deleteInvoiceDiscontinuedStyle(
  brandId: string,
  id: string,
): Promise<void> {
  const { data, error } = await getSupabase()
    .from('invoice_discontinued_styles')
    .delete()
    .eq('id', id)
    .eq('brand_id', brandId)
    .select('id')
  if (error) {
    throw new InvoiceDiscontinuedStyleStoreError(
      errorMessage(error, '단종 리스트에서 빼지 못했습니다.'),
    )
  }
  if (!data?.length) {
    throw new InvoiceDiscontinuedStyleStoreError(
      '삭제할 항목을 찾지 못했거나 권한이 없습니다.',
    )
  }
}
