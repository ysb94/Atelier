import { getSupabase } from '@/lib/supabase/client'
import { diagnosticOperation, tracedQuery } from '@/lib/diagnostics/workflow-trace'

export type BoxLabelBatch = { id: string; created_at: string; source: 'generated' | 'imported'; label_count: number }
export type IssuedBoxLabels = BoxLabelBatch & { codes: string[] }
export const BOX_LABEL_HISTORY_PAGE_SIZE = 10

export async function issueBoxLabels(brandId: string, requestId: string, count: number, codes?: string[]): Promise<IssuedBoxLabels> {
  return diagnosticOperation('app', 'issue_box_labels', async trace => trace.run('save', async context => {
    const { data, error } = await tracedQuery(getSupabase().rpc('issue_warehouse_box_labels', {
      p_brand_id: brandId, p_request_id: requestId, p_count: count, p_codes: codes ?? null,
    }), context)
    if (error) throw error
    if (!data?.id || !Array.isArray(data.codes) || data.codes.length !== count || data.codes.some((code: unknown) => typeof code !== 'string')) throw new Error('저장 결과를 확인할 수 없습니다. 같은 요청을 다시 확인해 주세요.')
    return data as IssuedBoxLabels
  }))
}

export async function listBoxLabelBatches(brandId: string, page: number): Promise<BoxLabelBatch[]> {
  return diagnosticOperation('app', 'list_box_labels', async trace => trace.run('read', async context => {
    const { data, error } = await tracedQuery(getSupabase().from('warehouse_box_label_batches')
      .select('id,created_at,source,label_count').eq('brand_id', brandId)
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(page * BOX_LABEL_HISTORY_PAGE_SIZE, (page + 1) * BOX_LABEL_HISTORY_PAGE_SIZE), context)
    if (error) throw error
    return data as BoxLabelBatch[]
  }))
}

export async function loadBoxLabelCodes(brandId: string, batchId: string): Promise<string[]> {
  return diagnosticOperation('app', 'load_box_labels', async trace => trace.run('read', async context => {
    const { data, error } = await tracedQuery(getSupabase().from('warehouse_box_labels')
      .select('code').eq('brand_id', brandId).eq('batch_id', batchId).order('ordinal'), context)
    if (error) throw error
    if (!data?.length) throw new Error('발급 번호를 찾지 못했습니다. 내역을 새로고침해 주세요.')
    return data.map(row => row.code as string)
  }))
}

export async function findBoxLabelCode(brandId: string, code: string): Promise<string> {
  return diagnosticOperation('app', 'find_box_label', async trace => trace.run('read', async context => {
    const { data, error } = await tracedQuery(getSupabase().from('warehouse_box_labels')
      .select('code').eq('brand_id', brandId).eq('code', code).maybeSingle(), context)
    if (error) throw error
    if (!data) throw new Error('등록된 번호가 없습니다. 전체 박스 번호를 확인해 주세요.')
    return data.code as string
  }))
}
