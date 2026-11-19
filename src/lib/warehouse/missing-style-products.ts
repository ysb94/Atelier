import type { WarehouseStockPosition } from '@/lib/types'
import { EMPTY_WAREHOUSE_LOCATION_CODE, isWarehouseQuantityKnown, warehousePositionQty } from './stock'

export type MissingStyleWarehousePosition = Pick<WarehouseStockPosition,
  'id' | 'styleNo' | 'sourceStyleNo' | 'styleName' | 'locationCode' | 'zone' | 'isFinalLocation'
  | 'quantityStatus' | 'unitsPerBox' | 'remainingBoxes' | 'openedUnits' | 'receivedOn' | 'receivedOnRaw'>

export function missingStyleWarehouseProducts(positions: readonly MissingStyleWarehousePosition[]) {
  return positions.filter(row => row.zone === 'box_storage' && !row.styleNo.trim() && !row.sourceStyleNo.trim()
    && row.locationCode.trim() && row.locationCode !== EMPTY_WAREHOUSE_LOCATION_CODE
    && (!isWarehouseQuantityKnown(row) || warehousePositionQty(row) > 0))
}
