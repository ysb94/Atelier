import { normalizeStyleNo } from '@/lib/import/transform'
import type { WarehouseStockPosition } from '@/lib/types'
import { compareWarehouseUsageOrder, EMPTY_WAREHOUSE_LOCATION_CODE, formatWarehouseLocation, isWarehouseQuantityKnown, warehousePositionQty } from './stock'

export type PopularLocationProduct = { name: string; styleNo: string }

export type PopularProductPosition = PopularLocationProduct & Pick<WarehouseStockPosition,
  'locationCode' | 'isFinalLocation' | 'isForcedPriority' | 'usagePriority' | 'receivedOn' | 'receivedOnRaw'
  | 'sourceRowNumber' | 'quantityStatus' | 'unitsPerBox' | 'remainingBoxes' | 'openedUnits'>

export function popularProductEntries(text: string): string[] {
  const entries = text.split(/\r?\n/).map(line => {
    const cells = line.split('\t').map(value => value.trim()).filter(Boolean)
    return cells.find(cell => /^M\d+$/i.test(cell)) ?? cells[0] ?? ''
  })
  return [...new Set(entries.filter(Boolean))]
}

export function popularProductLocations(entries: readonly string[], positions: readonly PopularProductPosition[]) {
  const byStyle = new Map<string, PopularProductPosition[]>()
  const byName = new Map<string, PopularProductPosition[]>()
  for (const position of positions) {
    const styleKey = normalizeStyleNo(position.styleNo)
    const nameKey = position.name.normalize('NFKC').trim()
    if (styleKey) {
      const group = byStyle.get(styleKey) ?? []
      group.push(position)
      byStyle.set(styleKey, group)
    }
    if (nameKey) {
      const group = byName.get(nameKey) ?? []
      group.push(position)
      byName.set(nameKey, group)
    }
  }
  return entries.flatMap(entry => {
    const matches = byStyle.get(normalizeStyleNo(entry)) ?? byName.get(entry.normalize('NFKC').trim()) ?? []
    const groups = new Map<string, PopularProductPosition[]>()
    for (const position of matches) {
      const key = normalizeStyleNo(position.styleNo) || position.name
      const group = groups.get(key) ?? []
      group.push(position)
      groups.set(key, group)
    }
    if (!groups.size) return [{ entry, styleNo: /^M\d+$/i.test(entry) ? normalizeStyleNo(entry) : '',
      name: /^M\d+$/i.test(entry) ? '' : entry, location: '', quantityUnknown: false, matched: false }]
    return [...groups.values()].map(group => {
      const active = group.filter(position => position.locationCode.trim() && position.locationCode !== EMPTY_WAREHOUSE_LOCATION_CODE
        && (!isWarehouseQuantityKnown(position) || warehousePositionQty(position) > 0))
      active.sort((left, right) => Number(isWarehouseQuantityKnown(right)) - Number(isWarehouseQuantityKnown(left))
        || compareWarehouseUsageOrder(left, right))
      const first = active[0]
      const product = first ?? group[0]!
      return { entry, styleNo: product.styleNo, name: product.name,
        location: first ? formatWarehouseLocation(first) : '',
        quantityUnknown: Boolean(first && !isWarehouseQuantityKnown(first)), matched: true }
    })
  })
}

export function popularProductAvailability(entries: readonly string[], products: readonly PopularLocationProduct[]) {
  const styles = new Set(products.filter(product => product.styleNo).map(product => normalizeStyleNo(product.styleNo)))
  const names = new Set(products.filter(product => product.name).map(product => product.name.normalize('NFKC').trim()))
  return entries.map(entry => ({
    entry,
    available: styles.has(normalizeStyleNo(entry)) || names.has(entry.normalize('NFKC').trim()),
  }))
}
