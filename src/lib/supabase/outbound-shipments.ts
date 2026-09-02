import type { ProductOutboundShipment } from '@/lib/outbound/product-outbound'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage } from '@/lib/supabase/map-error'
import { fetchAllPages } from '@/lib/supabase/paged-select'

export class OutboundShipmentStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OutboundShipmentStoreError'
  }
}

type ShipmentRow = {
  id: string
  brand_id: string
  style_id: string
  usage_target_id: string
  shipped_on: string
  quantity: number
  source: ProductOutboundShipment['source']
  source_ref: string | null
  note: string
}

function isSource(
  value: string,
): value is ProductOutboundShipment['source'] {
  return value === 'invoice' || value === 'bulk' || value === 'manual'
}

export async function listOutboundShipments(
  brandId: string,
): Promise<ProductOutboundShipment[]> {
  const rows = await fetchAllPages<ShipmentRow>({
    fetchPage: async (from, to, withCount) => {
      const { data, error, count } = await getSupabase()
        .from('outbound_shipments')
        .select(
          'id, brand_id, style_id, usage_target_id, shipped_on, quantity, source, source_ref, note',
          withCount ? { count: 'exact' } : undefined,
        )
        .eq('brand_id', brandId)
        .order('shipped_on', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to)
      if (error) {
        throw new OutboundShipmentStoreError(
          errorMessage(error, '출고 원장을 불러오지 못했습니다.'),
        )
      }
      return { rows: (data as ShipmentRow[]) ?? [], count: count ?? null }
    },
  })

  if (rows.length === 0) return []

  const styleIds = [...new Set(rows.map((row) => row.style_id))]
  const targetIds = [...new Set(rows.map((row) => row.usage_target_id))]

  const [stylesResult, targetsResult] = await Promise.all([
    getSupabase()
      .from('styles')
      .select('id, style_no, name')
      .eq('brand_id', brandId)
      .in('id', styleIds),
    getSupabase()
      .from('code_usage_targets')
      .select('id, name')
      .eq('brand_id', brandId)
      .in('id', targetIds),
  ])

  if (stylesResult.error) {
    throw new OutboundShipmentStoreError(
      errorMessage(stylesResult.error, '출고 상품을 불러오지 못했습니다.'),
    )
  }
  if (targetsResult.error) {
    throw new OutboundShipmentStoreError(
      errorMessage(targetsResult.error, '출고업체를 불러오지 못했습니다.'),
    )
  }

  const styleById = new Map(
    ((stylesResult.data as Array<{
      id: string
      style_no: string
      name: string
    }>) ?? []).map((row) => [row.id, row]),
  )
  const targetById = new Map(
    ((targetsResult.data as Array<{ id: string; name: string }>) ?? []).map(
      (row) => [row.id, row.name],
    ),
  )

  return rows
    .filter((row) => isSource(row.source) && row.quantity > 0)
    .map((row) => {
      const style = styleById.get(row.style_id)
      return {
        id: row.id,
        brandId: row.brand_id,
        styleId: row.style_id,
        styleNo: style?.style_no ?? '',
        styleName: style?.name ?? '',
        partnerId: row.usage_target_id,
        partnerName: targetById.get(row.usage_target_id) ?? '',
        shippedOn: row.shipped_on.slice(0, 10),
        quantity: row.quantity,
        source: row.source,
        note: row.note || undefined,
      }
    })
}
