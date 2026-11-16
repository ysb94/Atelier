import { diagnosticOperation } from '@/lib/diagnostics'
import { tracedQuery } from '@/lib/diagnostics/workflow-trace'
import { getSupabase } from './client'

const TABLE = 'warehouse_popular_locations'
const COLUMNS = 'location_codes, revision, updated_at'

type PopularLocationsRow = {
  location_codes: string[]
  revision: number
  updated_at: string
}

type PopularLocations = {
  codes: string[]
  revision: number
  updatedAt: string | null
}

type PopularLocationsRead =
  | { ready: false }
  | { ready: true; list: PopularLocations }

function toList(row: PopularLocationsRow | null): PopularLocations {
  return row
    ? { codes: row.location_codes, revision: row.revision, updatedAt: row.updated_at }
    : { codes: [], revision: 0, updatedAt: null }
}

export class WarehousePopularLocationsChangedError extends Error {
  constructor(options?: ErrorOptions) {
    super('저장된 자리 목록이 변경되었습니다.', options)
    this.name = 'WarehousePopularLocationsChangedError'
  }
}

export function readWarehousePopularLocations(brandId: string, signal: AbortSignal): Promise<PopularLocationsRead> {
  return diagnosticOperation('app', 'warehouse_popular_locations', async trace => {
    const query = getSupabase().from(TABLE).select(COLUMNS).eq('brand_id', brandId).abortSignal(signal).maybeSingle()
    const { data, error } = await trace.run('read_shared_list', context => tracedQuery(query, context))
    if (error) {
      trace.fail(error)
      if (error.code === 'PGRST205' || error.code === '42P01') return { ready: false }
      throw error
    }
    return { ready: true, list: toList(data as PopularLocationsRow | null) }
  })
}

export function saveWarehousePopularLocations(brandId: string, codes: string[], revision: number) {
  return diagnosticOperation('app', 'warehouse_popular_locations_save', async trace => {
    const table = getSupabase().from(TABLE)
    const query = revision === 0
      ? table.insert({ brand_id: brandId, location_codes: codes })
      : table.update({ location_codes: codes, revision: revision + 1 }).eq('brand_id', brandId).eq('revision', revision)

    const { data, error } = await trace.run('save_shared_list', context =>
      tracedQuery(query.select(COLUMNS).maybeSingle(), context),
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
    return toList(data as PopularLocationsRow)
  })
}
