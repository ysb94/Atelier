import { useMemo } from 'react'
import { useQueries, useQueryClient, type QueryKey, type UseQueryResult } from '@tanstack/react-query'
import { useCompanyBrandScope } from '@/components/layout/company-brand-scope'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { ATELIER_BRAND_ID } from '@/lib/company/capabilities'
import { diagnosticOperation } from '@/lib/diagnostics/workflow-trace'
import { getActiveWarehouseInventorySet, listRoomListStockPositions } from '@/lib/supabase/warehouse-stock'
import { emptyList } from '@/lib/utils'
import type { RoomListStockPosition, WarehouseInventorySet } from '@/lib/types'
import type { FixedLocationRow } from '@/lib/warehouse/fixed-location-styles'
import { indexRoomListLocations, indexRoomListStyleNumbers, roomListLocationCodes, roomListProductName } from './room-list-locations'
import { useWarehouseFixedLocationSnapshot } from './use-warehouse-fixed-location-snapshot'

const NAMES_PER_BATCH = 100
const MAX_STOCK_REQUESTS = 4
const waiting: (() => void)[] = []
let activeStockRequests = 0

async function withStockSlot<T>(signal: AbortSignal, read: () => Promise<T>): Promise<T> {
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    function start() {
      signal.removeEventListener('abort', cancel)
      activeStockRequests++
      resolve()
    }
    function cancel() {
      const index = waiting.indexOf(start)
      if (index >= 0) waiting.splice(index, 1)
      reject(signal.reason)
    }
    if (activeStockRequests < MAX_STOCK_REQUESTS) start()
    else {
      waiting.push(start)
      signal.addEventListener('abort', cancel, { once: true })
    }
  })
  try {
    signal.throwIfAborted()
    return await read()
  } finally {
    activeStockRequests--
    waiting.shift()?.()
  }
}

function stockErrorCode(error: Error | null) {
  const cause = error?.cause
  return typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined
}

function combineStock(results: UseQueryResult<RoomListStockPosition[]>[]) {
  return {
    data: results.map(result => ['P0002', '42501', 'PGRST301', 'PGRST303'].includes(String(stockErrorCode(result.error)))
      ? undefined : result.data),
    states: results.map(result => ({
      loading: result.isLoading || result.isPaused || (result.isError && result.isFetching),
      error: result.isError,
      inactiveSet: stockErrorCode(result.error) === 'P0002',
    })),
  }
}

function combineSets(results: UseQueryResult<WarehouseInventorySet | null>[]) {
  return {
    sets: results.flatMap(result => result.data ? [result.data] : []),
    loading: results.some(result => result.isLoading || result.isPaused || (result.isError && result.isFetching)),
    error: results.some(result => result.isError),
  }
}

export function useRoomListWarehouseLocations(userId: string, names: readonly string[]) {
  const { selectedBrands, loading, error } = useCompanyBrandScope()
  const hasNames = names.length > 0
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
  const batches = useMemo(() => sets.sets.flatMap(set => {
    const batches = []
    for (let from = 0; from < names.length; from += NAMES_PER_BATCH) {
      const batch = names.slice(from, from + NAMES_PER_BATCH)
      batches.push({
        set, names: batch,
        queryKey: ['warehouse-stock-positions', set.brandId, set.id, 'room-list', userId, batch] as const,
      })
    }
    return batches
  }), [sets.sets, names, userId])
  const stock = useQueries({
    queries: batches.map(batch => ({
      queryKey: batch.queryKey,
      queryFn: ({ signal }) => withStockSlot(signal, () => diagnosticOperation('app', 'room_list_warehouse', trace =>
        trace.run('read_stock_positions', context =>
          listRoomListStockPositions(batch.set.brandId, batch.set.id, batch.names, signal, context)))),
      retry: false,
      enabled,
    })),
    combine: combineStock,
  })
  const inactiveBrands = useMemo(() => new Set(batches
    .filter((_, index) => stock.states[index]?.inactiveSet)
    .map(batch => batch.set.brandId)), [batches, stock.states])
  const { locations, latestPositions, styleNumbers, requestedFixedRows } = useMemo(() => {
    const started = performance.now()
    const positions = stock.data.flatMap((rows, index) => inactiveBrands.has(batches[index].set.brandId) ? [] : rows ?? [])
    const requested = new Set(names)
    const requestedFixedRows = fixedRows.filter(row => requested.has(roomListProductName(row.productName)))
    const index = indexRoomListLocations(positions)
    const styleNumbers = indexRoomListStyleNumbers(requestedFixedRows, positions)
    const elapsed = Math.round(performance.now() - started)
    if (elapsed >= 200) {
      const log = elapsed >= 1000 ? console.warn : console.info
      log('[room-list] 창고 위치 정리', { elapsed, rows: positions.length })
    }
    return { ...index, styleNumbers, requestedFixedRows }
  }, [batches, fixedRows, inactiveBrands, names, stock.data])
  const locationCodes = useMemo(() => roomListLocationCodes(requestedFixedRows, locations), [requestedFixedRows, locations])
  const unavailableNames = useMemo(() => {
    const loadingNames = new Set<string>()
    const failedNames = new Set<string>()
    stock.states.forEach((state, index) => {
      for (const name of batches[index].names) {
        if (state.loading) loadingNames.add(name)
        if (state.error) failedNames.add(name)
      }
    })
    return { loadingNames, failedNames }
  }, [stock.states, batches])

  const sourceLoading = loading || sets.loading || (fixedBrandSelected &&
    (fixed.isLoading || fixed.isPaused || (fixed.isError && fixed.isFetching)))
  const sourceError = error || sets.error || inactiveBrands.size > 0 || (fixedBrandSelected && fixed.isError)
  function retryFailed(queryKey: QueryKey) {
    return cache.invalidateQueries({
      queryKey, exact: true,
      predicate: query => query.state.status === 'error' && query.state.fetchStatus === 'idle',
    }, { cancelRefetch: false })
  }

  return {
    locationCodes,
    latestPositions,
    styleNumbers,
    loading: sourceLoading || unavailableNames.loadingNames.size > 0 || (fixedBrandSelected && (styleLookup.isLoading || styleLookup.isPaused)),
    error: sourceError || unavailableNames.failedNames.size > 0,
    styleLookupError: fixedBrandSelected && styleLookup.isError,
    sourceLoading,
    sourceError,
    ...unavailableNames,
    refresh: () => Promise.all([
      retryFailed(['brands']),
      ...(fixedBrandSelected ? [retryFailed(fixedKey), retryFailed(styleLookupKey)] : []),
      ...selectedBrands.map(brand => {
        const queryKey = ['warehouse-inventory-set', brand.id]
        return inactiveBrands.has(brand.id)
          ? cache.invalidateQueries({ queryKey, exact: true }, { cancelRefetch: false })
          : retryFailed(queryKey)
      }),
      ...batches.filter(batch => !inactiveBrands.has(batch.set.brandId)).map(batch => retryFailed(batch.queryKey)),
    ]),
  }
}
