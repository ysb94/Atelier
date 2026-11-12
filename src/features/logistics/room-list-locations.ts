import type { WarehouseStockPosition } from '@/lib/types'
import { warehouseProductNameKey as roomListProductName, type FixedLocationRow } from '@/lib/warehouse/fixed-location-styles'
import {
  EMPTY_WAREHOUSE_LOCATION_CODE,
  FORCED_PRIORITY_DATE,
  LAST_PRIORITY_DATE,
  SECOND_PRIORITY_DATE,
  isWarehouseQuantityKnown,
  parseWarehouseLocation,
} from '@/lib/warehouse/stock'

const LOCATION_PREFIXES = '234$65#%89'
const locationOrder = new Intl.Collator('ko-KR', { numeric: true })

export { roomListProductName }

function prefixOrder(code: string) {
  const rank = LOCATION_PREFIXES.indexOf(code.trim().charAt(0))
  return rank < 0 ? LOCATION_PREFIXES.length : rank
}

function receiptOrder(position: WarehouseStockPosition) {
  const raw = position.receivedOnRaw.trim()
  if (raw === FORCED_PRIORITY_DATE) return '0000-00-00'
  if (raw === SECOND_PRIORITY_DATE) return '0000-00-01'
  if (raw === LAST_PRIORITY_DATE) return '9999-12-31'
  return position.receivedOn ?? '9999-12-30'
}

export function indexRoomListLocations(positions: readonly WarehouseStockPosition[]) {
  const groups = new Map<string, WarehouseStockPosition[]>()
  const latestPositions = new Map<string, WarehouseStockPosition>()
  for (const position of positions) {
    if (position.zone !== 'picking' && position.zone !== 'box_storage') continue
    const name = roomListProductName(position.styleName)
    const code = position.locationCode.trim()
    if (!name || !code || code === EMPTY_WAREHOUSE_LOCATION_CODE) continue
    if (isWarehouseQuantityKnown(position) &&
      position.remainingBoxes! * position.unitsPerBox! + position.openedUnits <= 0) continue

    const group = groups.get(name)
    if (group) group.push(position)
    else groups.set(name, [position])
  }

  for (const [name, group] of groups) {
    // Pick the latest receipt before collapsing multiple stock rows at a location.
    const latest = group.reduce((current, position) => {
      const order = (position.receivedOn ?? '').localeCompare(current.receivedOn ?? '') ||
        position.createdAt.localeCompare(current.createdAt) || position.sourceRowNumber - current.sourceRowNumber
      return order > 0 ? position : current
    })
    if (group.every(position => position.brandId === latest.brandId)) latestPositions.set(name, latest)
    group.sort((left, right) => receiptOrder(left).localeCompare(receiptOrder(right)) ||
      prefixOrder(left.locationCode) - prefixOrder(right.locationCode) ||
      locationOrder.compare(left.locationCode, right.locationCode) ||
      left.sourceRowNumber - right.sourceRowNumber)
    const seen = new Set<string>()
    groups.set(name, group.filter(position => {
      const key = JSON.stringify([
        position.brandId, position.warehouseId, position.zone, position.locationCode,
        position.styleId ?? (position.styleNo || position.sourceStyleNo),
      ])
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }))
  }
  return { locations: groups, latestPositions }
}

export function indexRoomListStyleNumbers(
  fixedRows: readonly FixedLocationRow[],
  positions: readonly Pick<WarehouseStockPosition, 'styleId' | 'styleNo' | 'styleName'>[],
) {
  const matches = new Map<string, { styleId: string; styleNo: string } | null>()
  function add(name: string, styleId: string | null | undefined, styleNo: string | undefined) {
    const trimmedStyleNo = styleNo?.trim()
    if (!name || !styleId || !trimmedStyleNo) return
    const existing = matches.get(name)
    if (existing === undefined) matches.set(name, { styleId, styleNo: trimmedStyleNo })
    else if (existing && (existing.styleId !== styleId || existing.styleNo !== trimmedStyleNo)) matches.set(name, null)
  }

  for (const row of fixedRows) {
    const code = row.location.trim()
    if (!code || code === EMPTY_WAREHOUSE_LOCATION_CODE) continue
    const name = roomListProductName(row.productName)
    if (row.ambiguousStyle) matches.set(name, null)
    else add(name, row.styleId, row.styleNo)
  }
  for (const position of positions) {
    add(roomListProductName(position.styleName), position.styleId, position.styleNo)
  }

  const numbers = new Map<string, string>()
  for (const [name, match] of matches) {
    if (match) numbers.set(name, match.styleNo)
  }
  return numbers
}

export function roomListLocationCodes(
  fixedRows: readonly FixedLocationRow[],
  warehouseLocations: ReadonlyMap<string, readonly WarehouseStockPosition[]>,
) {
  const groups = new Map<string, Map<string, string>>()
  function add(name: string, code: string) {
    const comparisonCode = parseWarehouseLocation(code).locationCode
    const group = groups.get(name)
    if (!group) groups.set(name, new Map([[comparisonCode, code]]))
    else if (!group.has(comparisonCode)) group.set(comparisonCode, code)
  }

  for (const row of fixedRows) {
    const name = roomListProductName(row.productName)
    const code = row.location.trim()
    if (name && code && code !== EMPTY_WAREHOUSE_LOCATION_CODE) add(name, code)
  }
  for (const [name, positions] of warehouseLocations) {
    for (const position of positions) add(name, position.locationCode.trim())
  }

  return new Map(Array.from(groups, ([name, codes]) => [name, [...codes.values()]]))
}
