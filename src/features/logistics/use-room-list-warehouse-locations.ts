import { useMemo } from 'react'
import { useQueries, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useCompanyBrandScope } from '@/components/layout/company-brand-scope'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { ATELIER_BRAND_ID } from '@/lib/company/capabilities'
import { diagnosticOperation } from '@/lib/diagnostics/workflow-trace'
import { combineListQueries, flattenListQueries } from '@/lib/query/list-queries'
import { getActiveWarehouseInventorySet, listWarehouseStockPositions } from '@/lib/supabase/warehouse-stock'
import { emptyList } from '@/lib/utils'
import type { WarehouseInventorySet, WarehouseStockPosition } from '@/lib/types'
import type { FixedLocationRow } from '@/lib/warehouse/fixed-location-styles'
import { indexRoomListLocations, indexRoomListStyleNumbers, roomListLocationCodes } from './room-list-locations'
import { useWarehouseFixedLocationSnapshot } from './use-warehouse-fixed-location-snapshot'

function combineSets(results: UseQueryResult<WarehouseInventorySet | null>[]) {
  return {
    sets: results.flatMap(result => result.data ? [result.data] : []),
    loading: results.some(result => result.isLoading),
    error: results.some(result => result.isError),
  }
}

export function useRoomListWarehouseLocations(hasNames: boolean) {
  const { selectedBrands, loading, error } = useCompanyBrandScope()
  const enabled = useWorkspaceTabActivity() && hasNames
  const cache = useQueryClient()
  const fixedBrandSelected = selectedBrands.some(brand => brand.id === ATELIER_BRAND_ID)
  const { snapshot: fixed, queryKey: fixedKey, rows: linkedRows, styleLookup, styleLookupKey } = useWarehouseFixedLocationSnapshot(ATELIER_BRAND_ID, hasNames && fixedBrandSelected)
  const fixedRows = fixedBrandSelected ? linkedRows : emptyList<FixedLocationRow>()
  const sets = useQueries({
    queries: selectedBrands.map(brand => ({
      queryKey: ['warehouse-inventory-set', brand.id],
      queryFn: () => diagnosticOperation('app', 'room_list_warehouse', trace =>
        trace.run('active_inventory', context => getActiveWarehouseInventorySet(brand.id, context))),
      enabled,
    })),
    combine: combineSets,
  })
  const stock = useQueries({
    queries: sets.sets.map(set => ({
      queryKey: ['warehouse-stock-positions', set.brandId, set.id],
      queryFn: () => diagnosticOperation('app', 'room_list_warehouse', trace =>
        trace.run('read_stock_positions', context => listWarehouseStockPositions(set.brandId, set.id, undefined, context))),
      enabled,
    })),
    combine: combineListQueries<WarehouseStockPosition>,
  })
  const { locations, latestPositions, styleNumbers } = useMemo(() => {
    const started = performance.now()
    const positions = flattenListQueries(stock)
    const index = indexRoomListLocations(positions)
    const styleNumbers = indexRoomListStyleNumbers(fixedRows, positions)
    const elapsed = Math.round(performance.now() - started)
    if (elapsed >= 200) {
      const log = elapsed >= 1000 ? console.warn : console.info
      log('[room-list] 창고 위치 정리', { elapsed, rows: positions.length })
    }
    return { ...index, styleNumbers }
  }, [fixedRows, stock])
  const locationCodes = useMemo(() => roomListLocationCodes(fixedRows, locations), [fixedRows, locations])

  return {
    locationCodes,
    latestPositions,
    styleNumbers,
    loading: loading || sets.loading || stock.loading || (fixedBrandSelected && (fixed.isLoading || styleLookup.isLoading)),
    error: error || sets.error || stock.errorIndexes.length > 0 || (fixedBrandSelected && fixed.isError),
    styleLookupError: fixedBrandSelected && styleLookup.isError,
    refresh: () => Promise.all([
      cache.invalidateQueries({ queryKey: ['brands'] }),
      ...(fixedBrandSelected ? [
        cache.invalidateQueries({ queryKey: fixedKey, exact: true }),
        cache.invalidateQueries({ queryKey: styleLookupKey, exact: true }),
      ] : []),
      ...selectedBrands.flatMap(brand => [
        cache.invalidateQueries({ queryKey: ['warehouse-inventory-set', brand.id] }),
        cache.invalidateQueries({ queryKey: ['warehouse-stock-positions', brand.id] }),
      ]),
    ]),
  }
}
