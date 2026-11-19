import { diagnosticOperation } from '@/lib/diagnostics'
import { tracedQuery } from '@/lib/diagnostics/workflow-trace'
import { getSupabase } from './client'

const TABLE = 'warehouse_popular_locations'
const COLUMNS = 'location_codes, revision, updated_at'
const PRODUCT_COLUMNS = 'location_codes, revision, updated_at, product_entries'

type PopularLocationsRow = {
  location_codes: string[]
  revision: number
  updated_at: string
  product_entries?: string[]
}

type PopularLocations = {
  codes: string[]
  revision: number
  updatedAt: string | null
  products: string[]
  productsReady: boolean
}

type PopularLocationsRead =
  | { ready: false }
  | { ready: true; list: PopularLocations }

function toList(row: PopularLocationsRow | null, productsReady = true): PopularLocations {
  return row
    ? { codes: row.location_codes, revision: row.revision, updatedAt: row.updated_at, products: row.product_entries ?? [], productsReady }
    : { codes: [], revision: 0, updatedAt: null, products: [], productsReady }
}

export class WarehousePopularLocationsChangedError extends Error {
  constructor(options?: ErrorOptions) {
    super('저장된 자리 목록이 변경되었습니다.', options)
    this.name = 'WarehousePopularLocationsChangedError'
  }
}

export function readWarehousePopularLocations(brandId: string, signal: AbortSignal): Promise<PopularLocationsRead> {
  return diagnosticOperation('app', 'warehouse_popular_locations', async trace => {
    const query = (columns: string) => getSupabase().from(TABLE).select(columns).eq('brand_id', brandId).abortSignal(signal).maybeSingle()
    let { data, error } = await trace.run('read_shared_list', context => tracedQuery(query(PRODUCT_COLUMNS), context))
    const productsReady = error?.code !== '42703' && error?.code !== 'PGRST204'
    if (!productsReady) {
      ({ data, error } = await trace.run('read_legacy_list', context => tracedQuery(query(COLUMNS), context)))
    }
    if (error) {
      trace.fail(error)
      if (error.code === 'PGRST205' || error.code === '42P01') return { ready: false }
      throw error
    }
    return { ready: true, list: toList(data as PopularLocationsRow | null, productsReady) }
  })
}

export function saveWarehousePopularLocations(brandId: string, codes: string[], revision: number, products?: string[]) {
  return diagnosticOperation('app', 'warehouse_popular_locations_save', async trace => {
    const table = getSupabase().from(TABLE)
    const changes = { location_codes: codes, ...(products === undefined ? {} : { product_entries: products }) }
    const query = revision === 0
      ? table.insert({ brand_id: brandId, ...changes })
      : table.update({ ...changes, revision: revision + 1 }).eq('brand_id', brandId).eq('revision', revision)
    const columns = products === undefined ? COLUMNS : PRODUCT_COLUMNS

    const { data, error } = await trace.run('save_shared_list', context =>
      tracedQuery(query.select(columns).maybeSingle().overrideTypes<PopularLocationsRow, { merge: false }>(), context),
    )
    if (error) {
      trace.fail(error)
      if (error.code === '23505' || error.code === '40001') {
        throw new WarehousePopularLocationsChangedError({ cause: error })
      }
      if (error.code === '42501') throw new Error('이 브랜드의 인기상품 자리를 저장할 권한이 없습니다.', { cause: error })
      throw new Error('자리 목록을 저장하지 못했습니다. 다시 시도해 주세요.', { cause: error })
    }
    if (!data) {
      trace.block('no_changed_row')
      throw new WarehousePopularLocationsChangedError()
    }
    trace.step('saved', { writeOutcome: 'committed' })
    return toList(data, products !== undefined)
  })
}
