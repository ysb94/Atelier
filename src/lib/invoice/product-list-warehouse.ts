import { normalizeStyleNo } from '@/lib/import/transform'
import type { InvoiceProductListEntry } from '@/lib/invoice/product-list-summary'
import type { WarehouseStockPosition, WarehouseZone } from '@/lib/types'
import {
  compareWarehouseUsageOrder,
  EMPTY_WAREHOUSE_LOCATION_CODE,
  formatWarehouseLocation,
  warehousePositionQty,
} from '@/lib/warehouse/stock'

export const UNSPECIFIED_LOCATION_ZONE = '미지정'

export const INVOICE_PRODUCT_LIST_WAREHOUSE_MODES: {
  value: WarehouseZone
  label: string
}[] = [
  { value: 'picking', label: '출고창고용' },
  { value: 'box_storage', label: '박스창고용' },
]

export type InvoiceProductListWarehouseLine = {
  styleNo: string
  styleName: string
  locationCode: string
  locationLabel: string
  locationZonePrefix: string
  quantity: number
  isShortage: boolean
}

export type InvoiceProductListWarehouseGroup = {
  locationZonePrefix: string
  lines: InvoiceProductListWarehouseLine[]
  quantity: number
  styleCount: number
}

export type InvoiceProductListWarehouseAllocation = {
  zone: WarehouseZone
  groups: InvoiceProductListWarehouseGroup[]
  lines: InvoiceProductListWarehouseLine[]
  totalRequested: number
  totalAllocated: number
  totalShortage: number
  stylesWithShortage: number
}

export function extractWarehouseLocationZonePrefix(locationCode: string) {
  const code = locationCode.trim()
  if (!code || code === EMPTY_WAREHOUSE_LOCATION_CODE) {
    return UNSPECIFIED_LOCATION_ZONE
  }
  if (code.includes('-')) {
    return code.split('-')[0]?.trim() || UNSPECIFIED_LOCATION_ZONE
  }
  const letters = code.match(/^[A-Za-z]+/)
  if (letters) return letters[0]!.toUpperCase()
  const digits = code.match(/^[0-9]+/)
  if (digits) return digits[0]!
  return code.slice(0, 1) || UNSPECIFIED_LOCATION_ZONE
}

export function compareWarehouseLocationCodeNatural(
  left: string,
  right: string,
) {
  return left.localeCompare(right, 'ko-KR', {
    numeric: true,
    sensitivity: 'base',
  })
}

export function compareWarehouseLocationZones(left: string, right: string) {
  if (left === right) return 0
  if (left === UNSPECIFIED_LOCATION_ZONE) return 1
  if (right === UNSPECIFIED_LOCATION_ZONE) return -1
  return compareWarehouseLocationCodeNatural(left, right)
}

function compareAllocatedLines(
  left: InvoiceProductListWarehouseLine,
  right: InvoiceProductListWarehouseLine,
) {
  const zone = compareWarehouseLocationZones(
    left.locationZonePrefix,
    right.locationZonePrefix,
  )
  if (zone !== 0) return zone
  if (left.isShortage !== right.isShortage) return left.isShortage ? 1 : -1
  const location = compareWarehouseLocationCodeNatural(
    left.locationLabel,
    right.locationLabel,
  )
  if (location !== 0) return location
  return left.styleNo.localeCompare(right.styleNo, 'ko-KR')
}

export function allocateInvoiceProductListWarehouse(input: {
  entries: InvoiceProductListEntry[]
  positions: WarehouseStockPosition[]
  zone: WarehouseZone
}): InvoiceProductListWarehouseAllocation {
  const byStyle = new Map<string, WarehouseStockPosition[]>()
  for (const position of input.positions) {
    if (position.zone !== input.zone) continue
    if (warehousePositionQty(position) <= 0) continue
    const styleNo = normalizeStyleNo(position.styleNo)
    if (!styleNo) continue
    const list = byStyle.get(styleNo) ?? []
    list.push(position)
    byStyle.set(styleNo, list)
  }
  for (const list of byStyle.values()) {
    list.sort(compareWarehouseUsageOrder)
  }

  const merged = new Map<string, InvoiceProductListWarehouseLine>()
  let totalRequested = 0
  let totalAllocated = 0
  let totalShortage = 0
  const shortageStyles = new Set<string>()

  for (const entry of input.entries) {
    const styleNo = normalizeStyleNo(entry.styleNo)
    if (!styleNo || entry.quantity <= 0) continue
    totalRequested += entry.quantity
    let remaining = entry.quantity
    for (const position of byStyle.get(styleNo) ?? []) {
      if (remaining <= 0) break
      const take = Math.min(remaining, warehousePositionQty(position))
      if (take <= 0) continue
      remaining -= take
      totalAllocated += take
      const locationLabel =
        formatWarehouseLocation(position) || UNSPECIFIED_LOCATION_ZONE
      const key = `${styleNo}\u0000${locationLabel}`
      const existing = merged.get(key)
      if (existing) {
        existing.quantity += take
        continue
      }
      merged.set(key, {
        styleNo,
        styleName: entry.styleName,
        locationCode: position.locationCode,
        locationLabel,
        locationZonePrefix: extractWarehouseLocationZonePrefix(
          position.locationCode,
        ),
        quantity: take,
        isShortage: false,
      })
    }
    if (remaining <= 0) continue
    totalShortage += remaining
    shortageStyles.add(styleNo)
    const key = `${styleNo}\u0000shortage`
    const existing = merged.get(key)
    if (existing) {
      existing.quantity += remaining
      continue
    }
    merged.set(key, {
      styleNo,
      styleName: entry.styleName,
      locationCode: '',
      locationLabel: UNSPECIFIED_LOCATION_ZONE,
      locationZonePrefix: UNSPECIFIED_LOCATION_ZONE,
      quantity: remaining,
      isShortage: true,
    })
  }

  const lines = [...merged.values()].sort(compareAllocatedLines)
  const groupMap = new Map<string, InvoiceProductListWarehouseLine[]>()
  for (const line of lines) {
    const list = groupMap.get(line.locationZonePrefix) ?? []
    list.push(line)
    groupMap.set(line.locationZonePrefix, list)
  }
  const groups = [...groupMap.entries()]
    .sort(([left], [right]) => compareWarehouseLocationZones(left, right))
    .map(([locationZonePrefix, groupLines]) => ({
      locationZonePrefix,
      lines: groupLines,
      quantity: groupLines.reduce((sum, line) => sum + line.quantity, 0),
      styleCount: new Set(groupLines.map((line) => line.styleNo)).size,
    }))

  return {
    zone: input.zone,
    groups,
    lines,
    totalRequested,
    totalAllocated,
    totalShortage,
    stylesWithShortage: shortageStyles.size,
  }
}
