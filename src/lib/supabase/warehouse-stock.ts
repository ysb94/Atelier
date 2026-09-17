import type {
  WarehouseInventoryKind,
  WarehouseInventorySet,
  WarehouseInventoryStatus,
  WarehouseLocation,
  WarehouseQuantityStatus,
  WarehouseReviewFlag,
  WarehouseStockAction,
  WarehouseStockMovement,
  WarehouseStockPosition,
  WarehouseUsagePriority,
  WarehouseZone,
} from '@/lib/types'
import { normalizeStyleNo } from '@/lib/import/transform'
import {
  assignWarehouseUsageRanks,
  toWarehouseImportRpcRows,
  type PreparedWarehouseImportRow,
} from '@/lib/warehouse/stock'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage } from '@/lib/supabase/map-error'

const PAGE_SIZE = 1000
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

const SET_COLUMNS =
  'id, brand_id, warehouse_id, kind, status, source_file_name, row_count, imported_at, imported_by'
const POSITION_COLUMNS =
  'id, brand_id, set_id, warehouse_id, location_id, style_id, source_style_no, normalized_style_no, source_product_name, received_on, received_on_raw, is_forced_priority, is_final_location, usage_priority, quantity_status, units_per_box, remaining_boxes, units_per_box_raw, remaining_boxes_raw, opened_units, review_flags, source_row_number, note, external_row_id, created_at, updated_at, warehouse_locations!inner(code, zone)'
const LOCATION_COLUMNS = 'id, warehouse_id, code, zone'
const MOVEMENT_COLUMNS =
  'id, brand_id, set_id, action, position_id, box_id, style_id, from_location_code, to_location_code, box_count, unit_count, reason, actor_id, created_at'

export class WarehouseStockStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WarehouseStockStoreError'
  }
}

type InventorySetRow = {
  id: string
  brand_id: string
  warehouse_id: string
  kind: WarehouseInventoryKind
  status: WarehouseInventoryStatus
  source_file_name: string
  row_count: number
  imported_at: string
  imported_by: string | null
}

type LocationRow = {
  id: string
  warehouse_id: string
  code: string
  zone: WarehouseZone
}

type PositionRow = {
  id: string
  brand_id: string
  set_id: string
  warehouse_id: string
  location_id: string
  style_id: string | null
  source_style_no: string
  normalized_style_no: string
  source_product_name: string
  received_on: string | null
  received_on_raw: string
  is_forced_priority: boolean
  is_final_location: boolean
  usage_priority: string | null
  quantity_status: string | null
  units_per_box: number | null
  remaining_boxes: number | null
  units_per_box_raw: string | null
  remaining_boxes_raw: string | null
  opened_units: number
  review_flags: string[] | null
  source_row_number: number
  note: string
  external_row_id: string | null
  created_at: string
  updated_at: string
  warehouse_locations?:
    | { code: string; zone: WarehouseZone }
    | Array<{ code: string; zone: WarehouseZone }>
    | null
}

type MovementRow = {
  id: string
  brand_id: string
  set_id: string
  action: WarehouseStockAction
  position_id: string | null
  box_id: string | null
  style_id: string | null
  from_location_code: string | null
  to_location_code: string | null
  box_count: number
  unit_count: number
  reason: string
  actor_id: string | null
  created_at: string
}

export type WarehouseReceiveInput = {
  styleId: string | null
  sourceStyleNo: string
  sourceProductName: string
  locationCode: string
  zone?: WarehouseZone
  receivedOn: string | null
  receivedOnRaw: string
  isForcedPriority: boolean
  isFinalLocation: boolean
  unitsPerBox: number
  remainingBoxes: number
  note?: string
}

export type WarehouseMoveInput = {
  positionId: string
  toLocationCode: string
  toZone?: WarehouseZone
  boxCount: number
  reason?: string
}

export type WarehouseAdjustInput = {
  positionId: string
  remainingBoxes: number
  openedUnits: number
  unitsPerBox?: number
  reason?: string
}

function toSet(row: InventorySetRow): WarehouseInventorySet {
  return {
    id: row.id,
    brandId: row.brand_id,
    warehouseId: row.warehouse_id,
    kind: row.kind,
    status: row.status,
    sourceFileName: row.source_file_name,
    rowCount: row.row_count,
    importedAt: row.imported_at,
    importedBy: row.imported_by,
  }
}

function toLocation(row: LocationRow): WarehouseLocation {
  return {
    id: row.id,
    warehouseId: row.warehouse_id,
    code: row.code,
    zone: row.zone,
  }
}

function toReviewFlags(value: string[] | null): WarehouseReviewFlag[] {
  return (value ?? []).filter((flag): flag is WarehouseReviewFlag =>
    REVIEW_FLAGS.has(flag as WarehouseReviewFlag),
  )
}

function embeddedLocation(row: PositionRow): WarehouseLocation | undefined {
  const raw = Array.isArray(row.warehouse_locations)
    ? row.warehouse_locations[0]
    : row.warehouse_locations
  if (!raw) return undefined
  return {
    id: row.location_id,
    warehouseId: row.warehouse_id,
    code: raw.code,
    zone: raw.zone,
  }
}

function toPosition(
  row: PositionRow,
  location: WarehouseLocation | undefined,
  usageRank: number | null,
): WarehouseStockPosition {
  return {
    id: row.id,
    brandId: row.brand_id,
    setId: row.set_id,
    warehouseId: row.warehouse_id,
    locationId: row.location_id,
    locationCode: location?.code ?? '',
    zone: location?.zone ?? 'box_storage',
    styleId: row.style_id,
    styleNo: row.normalized_style_no,
    styleName: row.source_product_name,
    sourceStyleNo: row.source_style_no,
    sourceProductName: row.source_product_name,
    receivedOn: row.received_on,
    receivedOnRaw: row.received_on_raw,
    isForcedPriority: row.is_forced_priority,
    isFinalLocation: row.is_final_location,
    usagePriority: USAGE_PRIORITIES.has(row.usage_priority as WarehouseUsagePriority)
      ? (row.usage_priority as WarehouseUsagePriority)
      : row.is_forced_priority
        ? 'first'
        : 'fifo',
    quantityStatus:
      row.quantity_status === 'unknown' ||
      row.units_per_box == null ||
      row.remaining_boxes == null
        ? 'unknown'
        : 'known',
    unitsPerBox: row.units_per_box,
    remainingBoxes: row.remaining_boxes,
    unitsPerBoxRaw: row.units_per_box_raw ?? '',
    remainingBoxesRaw: row.remaining_boxes_raw ?? '',
    openedUnits: row.opened_units,
    reviewFlags: toReviewFlags(row.review_flags),
    sourceRowNumber: row.source_row_number,
    note: row.note,
    externalRowId: row.external_row_id,
    usageRank,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toMovement(row: MovementRow): WarehouseStockMovement {
  return {
    id: row.id,
    brandId: row.brand_id,
    setId: row.set_id,
    action: row.action,
    positionId: row.position_id,
    boxId: row.box_id,
    styleId: row.style_id,
    fromLocationCode: row.from_location_code,
    toLocationCode: row.to_location_code,
    boxCount: row.box_count,
    unitCount: row.unit_count,
    reason: row.reason,
    actorId: row.actor_id,
    createdAt: row.created_at,
  }
}

export async function listWarehouseInventorySets(
  brandId: string,
): Promise<WarehouseInventorySet[]> {
  const supabase = getSupabase()
  const all: WarehouseInventorySet[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('warehouse_inventory_sets')
      .select(SET_COLUMNS)
      .eq('brand_id', brandId)
      .order('imported_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (error) {
      throw new WarehouseStockStoreError(
        errorMessage(error, '창고 연습 세트를 불러오지 못했습니다.'),
      )
    }
    const rows = (data as InventorySetRow[]) ?? []
    all.push(...rows.map(toSet))
    if (rows.length < PAGE_SIZE) break
  }
  return all
}

export async function getActiveWarehouseInventorySet(
  brandId: string,
): Promise<WarehouseInventorySet | null> {
  const sets = await listWarehouseInventorySets(brandId)
  return (
    sets.find((set) => set.kind === 'sandbox' && set.status === 'active') ??
    null
  )
}

export type WarehouseInventorySetRealtimeStatus =
  | 'connecting'
  | 'subscribed'
  | 'reconnecting'
  | 'error'

export function subscribeWarehouseInventorySetChanges(
  brandId: string,
  handlers: {
    onChange: () => void
    onStatus?: (status: WarehouseInventorySetRealtimeStatus) => void
  },
): () => void {
  const supabase = getSupabase()
  handlers.onStatus?.('connecting')
  const channel = supabase
    .channel(`warehouse-inventory-sets:${brandId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'warehouse_inventory_sets',
        filter: `brand_id=eq.${brandId}`,
      },
      () => {
        handlers.onChange()
      },
    )
    .subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        handlers.onStatus?.('subscribed')
        return
      }
      if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
        console.warn('[warehouse] Realtime 구독이 끊겼습니다', {
          brandId,
          status,
          message: error?.message,
        })
        handlers.onStatus?.(status === 'TIMED_OUT' ? 'reconnecting' : 'error')
        return
      }
      if (status === 'CLOSED') {
        handlers.onStatus?.('reconnecting')
      }
    })

  return () => {
    void supabase.removeChannel(channel)
  }
}

export async function listWarehouseLocations(
  warehouseId: string,
): Promise<WarehouseLocation[]> {
  const supabase = getSupabase()
  const all: WarehouseLocation[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('warehouse_locations')
      .select(LOCATION_COLUMNS)
      .eq('warehouse_id', warehouseId)
      .order('code', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) {
      throw new WarehouseStockStoreError(
        errorMessage(error, '창고 자리를 불러오지 못했습니다.'),
      )
    }
    const rows = (data as LocationRow[]) ?? []
    all.push(...rows.map(toLocation))
    if (rows.length < PAGE_SIZE) break
  }
  return all
}

export async function listWarehouseStockPositions(
  brandId: string,
  setId: string,
  zone?: WarehouseZone,
): Promise<WarehouseStockPosition[]> {
  const supabase = getSupabase()
  const raw: PositionRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('warehouse_stock_positions')
      .select(POSITION_COLUMNS)
      .eq('brand_id', brandId)
      .eq('set_id', setId)
      .order('source_row_number', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (zone) query = query.eq('warehouse_locations.zone', zone)
    const { data, error } = await query
    if (error) {
      throw new WarehouseStockStoreError(
        errorMessage(error, '창고 재고를 불러오지 못했습니다.'),
      )
    }
    const rows = (data as PositionRow[]) ?? []
    raw.push(...rows)
    if (rows.length < PAGE_SIZE) break
  }
  if (raw.length === 0) return []

  const ranked = assignWarehouseUsageRanks(
    raw.map((row) => ({
      styleNo: row.normalized_style_no,
      isFinalLocation: row.is_final_location,
      isForcedPriority: row.is_forced_priority,
      receivedOn: row.received_on,
      receivedOnRaw: row.received_on_raw,
      usagePriority: USAGE_PRIORITIES.has(
        row.usage_priority as WarehouseUsagePriority,
      )
        ? (row.usage_priority as WarehouseUsagePriority)
        : undefined,
      quantityStatus: (row.quantity_status ?? undefined) as
        | WarehouseQuantityStatus
        | undefined,
      sourceRowNumber: row.source_row_number,
      remainingBoxes: row.remaining_boxes,
      unitsPerBox: row.units_per_box,
      openedUnits: row.opened_units,
    })),
  )

  return raw.map((row, index) =>
    toPosition(row, embeddedLocation(row), ranked[index]?.usageRank ?? null),
  )
}

export async function listWarehouseStockMovements(
  brandId: string,
  setId: string,
  positionId?: string,
): Promise<WarehouseStockMovement[]> {
  const supabase = getSupabase()
  const all: WarehouseStockMovement[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('warehouse_stock_movements')
      .select(MOVEMENT_COLUMNS)
      .eq('brand_id', brandId)
      .eq('set_id', setId)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (positionId) query = query.eq('position_id', positionId)
    const { data, error } = await query
    if (error) {
      throw new WarehouseStockStoreError(
        errorMessage(error, '창고 이력을 불러오지 못했습니다.'),
      )
    }
    const rows = (data as MovementRow[]) ?? []
    all.push(...rows.map(toMovement))
    if (rows.length < PAGE_SIZE) break
  }
  return all
}

export async function importWarehouseInventorySet(
  brandId: string,
  sourceFileName: string,
  rows: PreparedWarehouseImportRow[],
  zone: WarehouseZone,
): Promise<WarehouseInventorySet> {
  const payload = toWarehouseImportRpcRows(rows, zone)
  const { data, error } = await getSupabase().rpc(
    'import_warehouse_inventory_set',
    {
      p_brand_id: brandId,
      p_source_file_name: sourceFileName,
      p_rows: payload,
    },
  )
  if (error || !data) {
    throw new WarehouseStockStoreError(
      errorMessage(error, '창고 연습 데이터를 가져오지 못했습니다.'),
    )
  }
  return toSet(data as InventorySetRow)
}

export async function restoreWarehouseInventorySet(
  brandId: string,
  setId: string,
): Promise<WarehouseInventorySet> {
  const { data, error } = await getSupabase().rpc(
    'restore_warehouse_inventory_set',
    {
      p_brand_id: brandId,
      p_set_id: setId,
    },
  )
  if (error || !data) {
    throw new WarehouseStockStoreError(
      errorMessage(error, '이전 연습 세트를 복원하지 못했습니다.'),
    )
  }
  return toSet(data as InventorySetRow)
}

export async function applyWarehouseStockAction(
  brandId: string,
  action: Exclude<WarehouseStockAction, 'import' | 'label'>,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await getSupabase().rpc('apply_warehouse_stock_action', {
    p_brand_id: brandId,
    p_action: action,
    p_payload: payload,
  })
  if (error) {
    throw new WarehouseStockStoreError(
      errorMessage(error, '창고 작업을 저장하지 못했습니다.'),
    )
  }
}

export async function receiveWarehouseStock(
  brandId: string,
  input: WarehouseReceiveInput,
): Promise<void> {
  await applyWarehouseStockAction(brandId, 'receive', {
    style_id: input.styleId,
    source_style_no: input.sourceStyleNo,
    normalized_style_no: normalizeStyleNo(input.sourceStyleNo),
    source_product_name: input.sourceProductName,
    location_code: input.locationCode,
    zone: input.zone ?? 'box_storage',
    received_on: input.receivedOn,
    received_on_raw: input.receivedOnRaw,
    is_forced_priority: input.isForcedPriority,
    is_final_location: input.isFinalLocation,
    units_per_box: input.unitsPerBox,
    remaining_boxes: input.remainingBoxes,
    note: input.note ?? '',
  })
}

export async function moveWarehouseStock(
  brandId: string,
  input: WarehouseMoveInput,
  action: 'move' | 'replenish' = 'move',
): Promise<void> {
  await applyWarehouseStockAction(brandId, action, {
    position_id: input.positionId,
    to_location_code: input.toLocationCode,
    to_zone: input.toZone,
    box_count: input.boxCount,
    reason: input.reason,
  })
}

export async function depleteWarehouseStock(
  brandId: string,
  positionId: string,
  reason?: string,
): Promise<void> {
  await applyWarehouseStockAction(brandId, 'deplete', {
    position_id: positionId,
    reason,
  })
}

export async function adjustWarehouseStock(
  brandId: string,
  input: WarehouseAdjustInput,
): Promise<void> {
  await applyWarehouseStockAction(brandId, 'adjust', {
    position_id: input.positionId,
    remaining_boxes: input.remainingBoxes,
    opened_units: input.openedUnits,
    units_per_box: input.unitsPerBox,
    reason: input.reason,
  })
}

export async function openWarehouseStock(
  brandId: string,
  positionId: string,
  boxCount: number,
  reason?: string,
): Promise<void> {
  await applyWarehouseStockAction(brandId, 'open', {
    position_id: positionId,
    box_count: boxCount,
    reason,
  })
}

export type WarehouseRegisteredSlot = {
  warehouseId: string
  code: string
  zone: WarehouseZone
}

type RegisteredSlotRow = {
  warehouse_id: string
  code: string
  zone: WarehouseZone
}

export async function listWarehouseRegisteredSlots(
  warehouseId: string,
): Promise<WarehouseRegisteredSlot[]> {
  if (!warehouseId.trim()) return []
  const { data, error } = await getSupabase()
    .from('warehouse_registered_slots')
    .select('warehouse_id, code, zone')
    .eq('warehouse_id', warehouseId)
    .order('code', { ascending: true })
  if (error) {
    throw new WarehouseStockStoreError(
      errorMessage(error, '창고 자리 등록을 불러오지 못했습니다.'),
    )
  }
  return ((data as RegisteredSlotRow[]) ?? []).map((row) => ({
    warehouseId: row.warehouse_id,
    code: row.code,
    zone: row.zone,
  }))
}

export async function saveWarehouseRegisteredSlots(
  warehouseId: string,
  zone: WarehouseZone,
  codes: readonly string[],
): Promise<void> {
  if (!warehouseId.trim()) {
    throw new WarehouseStockStoreError('창고를 확인하세요.')
  }
  const nextCodes = [
    ...new Set(codes.map((code) => code.trim()).filter(Boolean)),
  ]
  const existing = await listWarehouseRegisteredSlots(warehouseId)
  const currentZoneCodes = existing
    .filter((slot) => slot.zone === zone)
    .map((slot) => slot.code)
  const currentZoneSet = new Set(currentZoneCodes)
  const nextSet = new Set(nextCodes)
  const toDelete = currentZoneCodes.filter((code) => !nextSet.has(code))
  const toUpsert = nextCodes.filter((code) => {
    const current = existing.find((slot) => slot.code === code)
    return !currentZoneSet.has(code) || current?.zone !== zone
  })

  if (toDelete.length > 0) {
    const { error } = await getSupabase()
      .from('warehouse_registered_slots')
      .delete()
      .eq('warehouse_id', warehouseId)
      .eq('zone', zone)
      .in('code', toDelete)
    if (error) {
      throw new WarehouseStockStoreError(
        errorMessage(error, '창고 자리를 저장하지 못했습니다.'),
      )
    }
  }

  if (toUpsert.length === 0) return
  const { error } = await getSupabase()
    .from('warehouse_registered_slots')
    .upsert(
      toUpsert.map((code) => ({
        warehouse_id: warehouseId,
        code,
        zone,
      })),
      { onConflict: 'warehouse_id,code' },
    )
  if (error) {
    throw new WarehouseStockStoreError(
      errorMessage(error, '창고 자리를 저장하지 못했습니다.'),
    )
  }
}
