import type {
  WarehouseReviewFlag,
  WarehouseUsagePriority,
  WarehouseZone,
} from '@/lib/types'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage } from '@/lib/supabase/map-error'
import { WarehouseStockStoreError } from '@/lib/supabase/warehouse-stock'
import {
  finalizeWarehouseFinderResults,
  normalizeWarehouseFinderQuery,
  toWarehouseFinderCard,
  type WarehouseFinderCard,
  type WarehouseFinderSearchMode,
  type WarehouseFinderSearchQuery,
} from '@/lib/warehouse/finder'

const REVIEW_FLAGS = new Set<WarehouseReviewFlag>([
  'missing_style',
  'date_review',
  'duplicate_suspect',
  'special_location',
  'quantity_unknown',
])
const USAGE_PRIORITIES = new Set<WarehouseUsagePriority>([
  'first',
  'second',
  'fifo',
  'last',
])

type FinderRpcRow = {
  position_id: string
  set_id: string
  external_row_id: string | null
  location_code: string
  is_final_location: boolean
  zone: string
  style_id: string | null
  source_style_no: string
  normalized_style_no: string
  source_product_name: string
  official_style_name: string | null
  received_on: string | null
  received_on_raw: string
  usage_priority: string
  quantity_status: string
  units_per_box: number | string | null
  remaining_boxes: number | string | null
  opened_units: number | string | null
  review_flags: string[] | null
  note: string | null
  inbound_count: number | string | null
}

function toNumber(value: number | string | null | undefined) {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toReviewFlags(value: string[] | null): WarehouseReviewFlag[] {
  return (value ?? []).filter((flag): flag is WarehouseReviewFlag =>
    REVIEW_FLAGS.has(flag as WarehouseReviewFlag),
  )
}

function toCard(row: FinderRpcRow): WarehouseFinderCard {
  return toWarehouseFinderCard({
    positionId: row.position_id,
    setId: row.set_id,
    externalRowId: row.external_row_id,
    productName: row.source_product_name,
    officialStyleName: row.official_style_name,
    styleId: row.style_id,
    styleNo: row.normalized_style_no || row.source_style_no,
    sourceStyleNo: row.source_style_no,
    locationCode: row.location_code,
    isFinalLocation: row.is_final_location,
    zone: row.zone === 'picking' ? 'picking' : ('box_storage' as WarehouseZone),
    receivedOn: row.received_on,
    receivedOnRaw: row.received_on_raw,
    usagePriority: USAGE_PRIORITIES.has(row.usage_priority as WarehouseUsagePriority)
      ? (row.usage_priority as WarehouseUsagePriority)
      : 'fifo',
    quantityStatus:
      row.quantity_status === 'unknown' ||
      toNumber(row.units_per_box) == null ||
      toNumber(row.remaining_boxes) == null
        ? 'unknown'
        : 'known',
    unitsPerBox: toNumber(row.units_per_box),
    remainingBoxes: toNumber(row.remaining_boxes),
    openedUnits: toNumber(row.opened_units) ?? 0,
    reviewFlags: toReviewFlags(row.review_flags),
    note: row.note ?? '',
    inboundCount: toNumber(row.inbound_count) ?? 0,
  })
}

async function rpcFinderRows(
  fn: 'search_warehouse_finder_rows' | 'list_warehouse_finder_inbounds',
  args: Record<string, unknown>,
  fallbackMessage: string,
) {
  const { data, error } = await getSupabase().rpc(fn, args)
  if (error) {
    throw new WarehouseStockStoreError(errorMessage(error, fallbackMessage))
  }
  return ((data as FinderRpcRow[]) ?? []).map(toCard)
}

export async function searchWarehouseFinder(
  brandId: string,
  mode: WarehouseFinderSearchMode,
  rawQuery: string,
): Promise<{ query: WarehouseFinderSearchQuery; items: WarehouseFinderCard[] }> {
  const query = normalizeWarehouseFinderQuery(mode, rawQuery)
  if (!query.normalized) return { query, items: [] }
  const items = await rpcFinderRows(
    'search_warehouse_finder_rows',
    {
      p_brand_id: brandId,
      p_mode: query.mode,
      p_query: query.normalized,
      p_limit: query.limit,
    },
    '창고 파인더 검색에 실패했습니다.',
  )
  return { query, items: finalizeWarehouseFinderResults(query, items) }
}

export async function listWarehouseFinderInbounds(
  brandId: string,
  locationBase: string,
): Promise<WarehouseFinderCard[]> {
  const query = normalizeWarehouseFinderQuery('warehouse', locationBase)
  if (!query.normalized) return []
  const items = await rpcFinderRows(
    'list_warehouse_finder_inbounds',
    {
      p_brand_id: brandId,
      p_location_base: query.normalized,
      p_limit: query.limit,
    },
    '자리 입고 이력을 불러오지 못했습니다.',
  )
  return [...items].sort((left, right) => {
    if (left.receivedOn && right.receivedOn && left.receivedOn !== right.receivedOn) {
      return right.receivedOn.localeCompare(left.receivedOn)
    }
    return right.receivedOnRaw.localeCompare(left.receivedOnRaw, 'ko-KR')
  })
}
