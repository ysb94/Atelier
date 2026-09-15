import type {
  CargoInboundLineDraft,
  CargoInboundStage,
} from '@/lib/cargo/inbound'
import {
  cargoLineHasContent,
  parseCargoInteger,
} from '@/lib/cargo/inbound'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage } from '@/lib/supabase/map-error'

const SHIPMENT_COLUMNS =
  'id, brand_id, shipment_no, stage, shipped_on, scheduled_inbound_on, port_contact_note, vessel_name, origin_port, warehouse_summary, completed_at, created_at, updated_at, cargo_inbound_lines(id, source_row_no, item_no, product_name, source_style_no, quantity, units_per_box, box_count, photo_ref, note)'

type CargoInboundLineRow = {
  id: string
  source_row_no: number
  item_no: string
  product_name: string
  source_style_no: string
  quantity: number | null
  units_per_box: number | null
  box_count: number | null
  photo_ref: string
  note: string
}

type CargoInboundShipmentRow = {
  id: string
  brand_id: string
  shipment_no: string
  stage: CargoInboundStage
  shipped_on: string
  scheduled_inbound_on: string | null
  port_contact_note: string
  vessel_name: string
  origin_port: string
  warehouse_summary: string
  completed_at: string | null
  created_at: string
  updated_at: string
  cargo_inbound_lines?: CargoInboundLineRow[] | null
}

export type CargoInboundShipment = {
  id: string
  brandId: string
  shipmentNo: string
  stage: CargoInboundStage
  shippedAt: string
  scheduledInboundAt: string | null
  portContactNote: string
  vesselName: string
  originPort: string
  warehouseSummary: string
  completedAt: string | null
  createdAt: string
  updatedAt: string
  lines: CargoInboundLineDraft[]
}

export type SaveCargoInboundInput = {
  brandId: string
  shipDate: string
  rows: CargoInboundLineDraft[]
}

export class CargoInboundStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CargoInboundStoreError'
  }
}

function formatOptionalInteger(value: number | null): string {
  return value == null ? '' : String(value)
}

function toShipment(row: CargoInboundShipmentRow): CargoInboundShipment {
  const lines = [...(row.cargo_inbound_lines ?? [])]
    .sort((left, right) => left.source_row_no - right.source_row_no)
    .map((line) => ({
      no: line.item_no,
      name: line.product_name,
      photo: line.photo_ref,
      styleNo: line.source_style_no,
      qty: formatOptionalInteger(line.quantity),
      perBox: formatOptionalInteger(line.units_per_box),
      boxes: formatOptionalInteger(line.box_count),
      note: line.note,
    }))

  return {
    id: row.id,
    brandId: row.brand_id,
    shipmentNo: row.shipment_no,
    stage: row.stage,
    shippedAt: row.shipped_on,
    scheduledInboundAt: row.scheduled_inbound_on,
    portContactNote: row.port_contact_note,
    vesselName: row.vessel_name,
    originPort: row.origin_port,
    warehouseSummary: row.warehouse_summary,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lines,
  }
}

function cleanBrandIds(brandIds: readonly string[]): string[] {
  return [...new Set(brandIds.map((id) => id.trim()).filter(Boolean))]
}

export async function listCargoInbounds(
  brandIds: readonly string[],
): Promise<CargoInboundShipment[]> {
  const ids = cleanBrandIds(brandIds)
  if (ids.length === 0) return []

  const { data, error } = await getSupabase()
    .from('cargo_inbound_shipments')
    .select(SHIPMENT_COLUMNS)
    .in('brand_id', ids)
    .order('shipped_on', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    throw new CargoInboundStoreError(
      errorMessage(error, '화물 입고 목록을 불러오지 못했습니다.'),
    )
  }
  return ((data as CargoInboundShipmentRow[]) ?? []).map(toShipment)
}

export async function saveCargoInbound(
  input: SaveCargoInboundInput,
): Promise<string> {
  const rows = input.rows.filter(cargoLineHasContent)
  if (!input.brandId.trim()) {
    throw new CargoInboundStoreError('브랜드를 선택하세요.')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.shipDate)) {
    throw new CargoInboundStoreError('선적일을 확인하세요.')
  }
  if (rows.length === 0) {
    throw new CargoInboundStoreError('저장할 화물 품목이 없습니다.')
  }

  let lines: Array<Record<string, string | number | null>>
  try {
    lines = rows.map((row, index) => ({
      source_row_no: index + 1,
      item_no: row.no.trim() || String(index + 1),
      product_name: row.name.trim(),
      source_style_no: row.styleNo.trim(),
      quantity: parseCargoInteger(row.qty, `${index + 1}행 총수량`),
      units_per_box: parseCargoInteger(row.perBox, `${index + 1}행 박스 당`),
      box_count: parseCargoInteger(row.boxes, `${index + 1}행 박스`),
      photo_ref: row.photo.trim(),
      note: row.note.trim(),
    }))
  } catch (error) {
    throw new CargoInboundStoreError(
      error instanceof Error ? error.message : '화물 수량을 확인하세요.',
    )
  }

  const { data, error } = await getSupabase().rpc('save_cargo_inbound', {
    p_brand_id: input.brandId,
    p_shipped_on: input.shipDate,
    p_lines: lines,
  })

  if (error || typeof data !== 'string') {
    throw new CargoInboundStoreError(
      errorMessage(error, '화물 입고를 저장하지 못했습니다.'),
    )
  }
  return data
}

export async function scheduleCargoInbound(
  brandId: string,
  shipmentId: string,
  inboundDate: string,
  note: string,
): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inboundDate)) {
    throw new CargoInboundStoreError('입고일을 확인하세요.')
  }

  const { data, error } = await getSupabase()
    .from('cargo_inbound_shipments')
    .update({
      stage: 'scheduled',
      scheduled_inbound_on: inboundDate,
      port_contact_note: note.trim(),
    })
    .eq('brand_id', brandId)
    .eq('id', shipmentId)
    .select('id')
    .maybeSingle()

  if (error || !data) {
    throw new CargoInboundStoreError(
      errorMessage(error, '화물 입고일을 저장하지 못했습니다.'),
    )
  }
}
