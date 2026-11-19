import { getSupabase } from './client'
import { diagnosticQuery } from './diagnostic-query'

export type WarehouseActivityRow = {
  id?: string
  qr?: string
  sku?: string
  name?: string
  location?: string
  receivedOn?: string
  unitsPerBox?: string
  boxes?: string
  opened?: string
  quantity?: number
  workedUnits?: number
  workedBoxes?: number
  note?: string
}

export type WarehouseActivity = {
  id: string
  source: 'atelier' | 'finder' | 'warehouse'
  action: string
  actor_name: string | null
  place: string | null
  reason: string | null
  before_rows: WarehouseActivityRow[]
  after_rows: WarehouseActivityRow[]
  created_at: string
}

export type WarehouseActivityCursor = Pick<WarehouseActivity, 'created_at' | 'id'>

const PAGE_SIZE = 50

export async function listWarehouseActivity(brandId: string, qr: string | null, search: string, cursor: WarehouseActivityCursor | null) {
  try {
    const result = await diagnosticQuery<WarehouseActivity[]>('app', 'list_warehouse_activity', getSupabase().rpc('list_warehouse_activity', {
      p_brand: brandId, p_qr: qr, p_search: search.trim() || null,
      p_before_at: cursor?.created_at ?? null, p_before_id: cursor?.id ?? null,
    }))
    const rows = result?.slice(0, PAGE_SIZE) ?? []
    const last = result && result.length > PAGE_SIZE ? rows.at(-1) : undefined
    const next = last ? { id: last.id, created_at: last.created_at } : null
    return { supported: true, rows, next }
  } catch (error) {
    const code = (error as Error & { cause?: { code?: string } }).cause?.code
    if (code === 'PGRST202' || code === '42883') return { supported: false, rows: [], next: null }
    throw error
  }
}
