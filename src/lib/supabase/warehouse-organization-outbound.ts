import { diagnosticOperation, tracedQuery } from '@/lib/diagnostics/workflow-trace'
import { getSupabase } from './client'

const TABLE = 'warehouse_organization_outbound_months'
const COLUMNS = 'items, revision, updated_at'

export type WarehouseOrganizationOutboundItem = {
  productName: string
  quantity: number
}

type MonthlyOutbound = {
  items: WarehouseOrganizationOutboundItem[]
  revision: number
  updated_at: string
}

type MonthlyOutboundRead =
  | { ready: false }
  | { ready: true; record: MonthlyOutbound | null }

export class WarehouseOrganizationOutboundChangedError extends Error {
  constructor() {
    super('이 달의 저장 자료가 변경됐습니다. 새로 불러온 뒤 다시 저장해 주세요.')
  }
}

export function readWarehouseOrganizationOutbound(
  brandId: string, month: string, signal: AbortSignal,
): Promise<MonthlyOutboundRead> {
  return diagnosticOperation('app', 'warehouse_organization_outbound', async trace => {
    const query = getSupabase().from(TABLE).select(COLUMNS)
      .eq('brand_id', brandId).eq('outbound_month', `${month}-01`).abortSignal(signal).maybeSingle()
    const { data, error } = await trace.run('read_month', context => tracedQuery(query, context))
    if (error) {
      trace.fail(error)
      if (error.code === 'PGRST205' || error.code === '42P01') return { ready: false }
      throw error
    }
    return { ready: true, record: data as MonthlyOutbound | null }
  })
}

export function saveWarehouseOrganizationOutbound(
  brandId: string, month: string, items: WarehouseOrganizationOutboundItem[], revision: number,
): Promise<MonthlyOutbound> {
  return diagnosticOperation('app', 'warehouse_organization_outbound_save', async trace => {
    const table = getSupabase().from(TABLE)
    const date = `${month}-01`
    const query = revision === 0
      ? table.insert({ brand_id: brandId, outbound_month: date, items })
      : table.update({ items, revision: revision + 1 })
        .eq('brand_id', brandId).eq('outbound_month', date).eq('revision', revision)
    const { data, error } = await trace.run('save_month', context =>
      tracedQuery(query.select(COLUMNS).maybeSingle(), context),
    )
    if (error) {
      trace.fail(error)
      if (error.code === '23505' || error.code === '40001') throw new WarehouseOrganizationOutboundChangedError()
      if (error.code === '42501') throw new Error('이 브랜드의 출고 데이터를 저장할 권한이 없습니다.')
      throw new Error('출고 데이터를 저장하지 못했습니다. 저장 자료를 다시 불러와 확인해 주세요.')
    }
    if (!data) {
      trace.block('no_changed_row')
      throw new WarehouseOrganizationOutboundChangedError()
    }
    trace.step('saved', { writeOutcome: 'committed' })
    return data as MonthlyOutbound
  })
}
