import type { ProductOutboundShipment } from '@/lib/outbound/product-outbound'
import { outboundPartnerOptionLabel } from '@/lib/codes/outbound-partner'
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
      .select(
        'id, name, channel_type, site_name, outbound_partner_groups(name)',
      )
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
    ((
      targetsResult.data as unknown as Array<{
        id: string
        name: string
        channel_type: 'unset' | 'online' | 'offline'
        site_name: string
        outbound_partner_groups:
          | { name: string }
          | { name: string }[]
          | null
      }>
    ) ?? []).map((row) => {
      const group = Array.isArray(row.outbound_partner_groups)
        ? row.outbound_partner_groups[0]
        : row.outbound_partner_groups
      return [
        row.id,
        outboundPartnerOptionLabel({
          name: row.name,
          groupName: group?.name ?? '',
          siteName: row.site_name,
          channelType: row.channel_type,
        }),
      ]
    }),
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export type BarcodeDataEntryShipmentEntry = {
  usageTargetId: string
  styleId: string
  quantity: number
}

/** 같은 업체 그룹·출고일의 데이터입력 반영분을 지점별로 교체한다. 재고는 건드리지 않는다. */
export async function replaceBarcodeDataEntryShipments(input: {
  brandId: string
  sourceRef: string
  shippedOn: string
  note: string
  partnerIds?: readonly string[]
  entries: readonly BarcodeDataEntryShipmentEntry[]
}): Promise<number> {
  if (!UUID_RE.test(input.brandId)) {
    throw new OutboundShipmentStoreError('브랜드 정보가 올바르지 않습니다.')
  }
  if (!ISO_DATE_RE.test(input.shippedOn)) {
    throw new OutboundShipmentStoreError('출고일을 확인하세요.')
  }
  if (!input.sourceRef.trim()) {
    throw new OutboundShipmentStoreError('출고 출처가 올바르지 않습니다.')
  }

  const rows = input.entries
    .map((entry) => ({
      usageTargetId: entry.usageTargetId.trim(),
      styleId: entry.styleId.trim(),
      quantity: Math.trunc(entry.quantity),
    }))
    .filter(
      (entry) =>
        UUID_RE.test(entry.usageTargetId) &&
        UUID_RE.test(entry.styleId) &&
        Number.isFinite(entry.quantity) &&
        entry.quantity > 0,
    )

  const partnerIds = [
    ...new Set(
      [...(input.partnerIds ?? []), ...rows.map((row) => row.usageTargetId)].filter(
        (id) => UUID_RE.test(id),
      ),
    ),
  ]

  const { data, error } = await getSupabase().rpc(
    'replace_barcode_data_entry_shipments',
    {
      p_brand_id: input.brandId,
      p_source_ref: input.sourceRef,
      p_shipped_on: input.shippedOn,
      p_note: input.note.trim(),
      p_usage_target_ids: partnerIds,
      p_entries: rows.map((entry) => ({
        usageTargetId: entry.usageTargetId,
        styleId: entry.styleId,
        quantity: entry.quantity,
      })),
    },
  )

  if (error) {
    throw new OutboundShipmentStoreError(
      errorMessage(error, '출고 데이터에 반영하지 못했습니다.'),
    )
  }

  return typeof data === 'number' ? data : rows.length
}
