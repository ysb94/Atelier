import { parseInvoiceProductListRoutePresetGroups } from '@/lib/invoice/product-list-route'
import type {
  InvoicePickingRoutePreset,
  InvoicePickingRoutePresetGroup,
  WarehouseZone,
} from '@/lib/types'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'

const PRESET_COLUMNS =
  'id, brand_id, warehouse_zone, name, sort_order, route_groups, created_at, updated_at'
const PAGE_SIZE = 1000
const WAREHOUSE_ZONES = new Set<WarehouseZone>(['picking', 'box_storage'])

type PresetRow = {
  id: string
  brand_id: string
  warehouse_zone: string
  name: string
  sort_order: number
  route_groups: unknown
  created_at: string
  updated_at: string
}

export class InvoicePickingRoutePresetStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoicePickingRoutePresetStoreError'
  }
}

export type InvoicePickingRoutePresetInput = {
  name?: string
  routeGroups?: InvoicePickingRoutePresetGroup[]
  sortOrder?: number
}

function parseWarehouseZone(value: string): WarehouseZone | null {
  return WAREHOUSE_ZONES.has(value as WarehouseZone)
    ? (value as WarehouseZone)
    : null
}

function toPreset(row: PresetRow): InvoicePickingRoutePreset | null {
  const warehouseZone = parseWarehouseZone(row.warehouse_zone)
  if (!warehouseZone) return null
  return {
    id: row.id,
    brandId: row.brand_id,
    warehouseZone,
    name: row.name,
    sortOrder: row.sort_order,
    routeGroups: parseInvoiceProductListRoutePresetGroups(row.route_groups),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function requireName(name: string) {
  const next = name.trim()
  if (!next) {
    throw new InvoicePickingRoutePresetStoreError('동선 이름을 입력하세요.')
  }
  return next
}

function requireZone(warehouseZone: WarehouseZone) {
  if (!WAREHOUSE_ZONES.has(warehouseZone)) {
    throw new InvoicePickingRoutePresetStoreError('창고를 지정하세요.')
  }
  return warehouseZone
}

async function nextSortOrder(
  brandId: string,
  warehouseZone: WarehouseZone,
): Promise<number> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('invoice_picking_route_presets')
    .select('sort_order')
    .eq('brand_id', brandId)
    .eq('warehouse_zone', warehouseZone)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    throw new InvoicePickingRoutePresetStoreError(
      errorMessage(error, '동선 순서를 확인하지 못했습니다.'),
    )
  }
  return ((data as { sort_order?: number } | null)?.sort_order ?? -1) + 1
}

export async function listInvoicePickingRoutePresets(
  brandId: string,
  warehouseZone: WarehouseZone,
): Promise<InvoicePickingRoutePreset[]> {
  const zone = requireZone(warehouseZone)
  const supabase = getSupabase()
  const all: InvoicePickingRoutePreset[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('invoice_picking_route_presets')
      .select(PRESET_COLUMNS)
      .eq('brand_id', brandId)
      .eq('warehouse_zone', zone)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) {
      throw new InvoicePickingRoutePresetStoreError(
        errorMessage(error, '동선 사전을 불러오지 못했습니다.'),
      )
    }
    const rows = (data as PresetRow[]) ?? []
    all.push(
      ...rows
        .map(toPreset)
        .filter((item): item is InvoicePickingRoutePreset => Boolean(item)),
    )
    if (rows.length < PAGE_SIZE) break
  }
  return all
}

export async function createInvoicePickingRoutePreset(
  brandId: string,
  warehouseZone: WarehouseZone,
  input: InvoicePickingRoutePresetInput,
): Promise<InvoicePickingRoutePreset> {
  const zone = requireZone(warehouseZone)
  const name = requireName(input.name ?? '')
  const routeGroups = parseInvoiceProductListRoutePresetGroups(
    input.routeGroups ?? [],
  )
  const sortOrder =
    input.sortOrder ?? (await nextSortOrder(brandId, zone))
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('invoice_picking_route_presets')
    .insert({
      brand_id: brandId,
      warehouse_zone: zone,
      name,
      sort_order: sortOrder,
      route_groups: routeGroups,
    })
    .select(PRESET_COLUMNS)
    .single()
  if (error || !data) {
    if (isUniqueViolation(error ?? {})) {
      throw new InvoicePickingRoutePresetStoreError(
        '같은 이름의 동선이 이미 있습니다.',
      )
    }
    throw new InvoicePickingRoutePresetStoreError(
      errorMessage(error, '동선을 저장하지 못했습니다.'),
    )
  }
  const preset = toPreset(data as PresetRow)
  if (!preset) {
    throw new InvoicePickingRoutePresetStoreError('저장한 동선을 읽지 못했습니다.')
  }
  return preset
}

export async function updateInvoicePickingRoutePreset(
  id: string,
  input: InvoicePickingRoutePresetInput,
): Promise<InvoicePickingRoutePreset> {
  const payload: {
    name?: string
    route_groups?: InvoicePickingRoutePresetGroup[]
    sort_order?: number
  } = {}
  if (input.name !== undefined) payload.name = requireName(input.name)
  if (input.routeGroups !== undefined) {
    payload.route_groups = parseInvoiceProductListRoutePresetGroups(
      input.routeGroups,
    )
  }
  if (input.sortOrder !== undefined) payload.sort_order = input.sortOrder
  if (Object.keys(payload).length === 0) {
    throw new InvoicePickingRoutePresetStoreError('바꿀 내용을 입력하세요.')
  }
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('invoice_picking_route_presets')
    .update(payload)
    .eq('id', id)
    .select(PRESET_COLUMNS)
    .single()
  if (error || !data) {
    if (isUniqueViolation(error ?? {})) {
      throw new InvoicePickingRoutePresetStoreError(
        '같은 이름의 동선이 이미 있습니다.',
      )
    }
    throw new InvoicePickingRoutePresetStoreError(
      errorMessage(error, '동선을 수정하지 못했습니다.'),
    )
  }
  const preset = toPreset(data as PresetRow)
  if (!preset) {
    throw new InvoicePickingRoutePresetStoreError('수정한 동선을 읽지 못했습니다.')
  }
  return preset
}

export async function deleteInvoicePickingRoutePreset(
  id: string,
): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase
    .from('invoice_picking_route_presets')
    .delete()
    .eq('id', id)
  if (error) {
    throw new InvoicePickingRoutePresetStoreError(
      errorMessage(error, '동선을 지우지 못했습니다.'),
    )
  }
}
