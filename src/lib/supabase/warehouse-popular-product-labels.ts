import { diagnosticOperation, tracedQuery } from '@/lib/diagnostics/workflow-trace'
import { getSupabase } from './client'

type PopularProductLabel = { style_no: string; product_name: string }

export function listWarehousePopularProductLabels(brandId: string, signal: AbortSignal) {
  return diagnosticOperation('app', 'warehouse_popular_product_labels', async trace => {
    const query = getSupabase().rpc('list_warehouse_popular_product_labels', {
      p_brand_id: brandId,
    }).abortSignal(signal)
    const { data, error } = await trace.run('read_labels', context => tracedQuery(query, context))
    if (error) {
      trace.fail(error)
      throw error
    }
    return (data ?? []) as PopularProductLabel[]
  })
}
