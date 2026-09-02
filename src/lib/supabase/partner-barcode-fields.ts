import { getSupabase } from '@/lib/supabase/client'
import { errorMessage } from '@/lib/supabase/map-error'

export type PartnerBarcodeField = {
  id: string
  label: string
  type: 'text' | 'number'
  order: number
}

export class PartnerBarcodeFieldStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PartnerBarcodeFieldStoreError'
  }
}

type FieldRow = {
  id: string
  label: string
  type: 'text' | 'number'
  sort_order: number
}

function toField(row: FieldRow): PartnerBarcodeField {
  return {
    id: row.id,
    label: row.label,
    type: row.type === 'number' ? 'number' : 'text',
    order: row.sort_order,
  }
}

export async function listPartnerBarcodeFields(
  brandId: string,
  usageTargetId: string,
): Promise<PartnerBarcodeField[]> {
  const { data, error } = await getSupabase()
    .from('partner_barcode_fields')
    .select('id, label, type, sort_order')
    .eq('brand_id', brandId)
    .eq('usage_target_id', usageTargetId)
    .order('sort_order', { ascending: true })

  if (error) {
    throw new PartnerBarcodeFieldStoreError(
      errorMessage(error, '거래처 헤더를 불러오지 못했습니다.'),
    )
  }

  return ((data as FieldRow[]) ?? []).map(toField)
}

export async function replacePartnerBarcodeFields(
  brandId: string,
  usageTargetId: string,
  fields: Array<{
    id?: string
    label: string
    type: 'text' | 'number'
    order: number
  }>,
): Promise<PartnerBarcodeField[]> {
  const { data, error } = await getSupabase().rpc(
    'replace_partner_barcode_fields',
    {
      p_brand_id: brandId,
      p_usage_target_id: usageTargetId,
      p_fields: fields.map((field) => ({
        id: field.id,
        label: field.label,
        type: field.type,
        order: field.order,
      })),
    },
  )

  if (error) {
    throw new PartnerBarcodeFieldStoreError(
      errorMessage(error, '거래처 헤더를 저장하지 못했습니다.'),
    )
  }

  const parsed = Array.isArray(data) ? data : []
  return parsed.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as {
      id?: unknown
      label?: unknown
      type?: unknown
      order?: unknown
    }
    if (typeof row.id !== 'string' || typeof row.label !== 'string') return []
    return [
      {
        id: row.id,
        label: row.label,
        type: row.type === 'number' ? 'number' : 'text',
        order: typeof row.order === 'number' ? row.order : 0,
      } satisfies PartnerBarcodeField,
    ]
  })
}
