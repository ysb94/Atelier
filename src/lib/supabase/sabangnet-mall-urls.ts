import { getSupabase } from './client'
import { fetchAllPages } from './paged-select'
import type { SabangnetMallUrl } from '@/lib/codes/sabangnet-url-import'

type Row = { id: string; brand_id: string; product_id: string; target_id: string; url: string; mall_product_code: string; mall_product_name: string; source_mall: string; source_file: string; source_row: number }
export async function listSabangnetMallUrls(brandId: string, options: { activeTargetsOnly?: boolean } = {}): Promise<SabangnetMallUrl[]> {
  const rows = await fetchAllPages<Row>({ fetchPage: async (from, to, withCount) => {
    // The composite foreign key keeps the joined target within the URL's brand.
    const table = getSupabase().from('sabangnet_mall_urls')
    const countOptions = withCount ? { count: 'exact' as const } : undefined
    const query = options.activeTargetsOnly
      ? table.select('*,code_usage_targets!inner(active)', countOptions).eq('code_usage_targets.active', true)
      : table.select('*', countOptions)
    const { data, error, count } = await query.eq('brand_id', brandId).order('id').range(from, to)
    if (error) throw new Error(`업체별 URL을 불러오지 못했습니다. ${error.message}`)
    return { rows: (data as Row[]) ?? [], count }
  } })
  return rows.map(r => ({ id: r.id, brandId: r.brand_id, productId: r.product_id, targetId: r.target_id, url: r.url, mallProductCode: r.mall_product_code, mallProductName: r.mall_product_name, sourceMall: r.source_mall, sourceFile: r.source_file, sourceRow: r.source_row }))
}
export async function importSabangnetMallUrls(brandId: string, sourceFile: string, rows: unknown[], onProgress?: (done: number, total: number) => void) {
  const result = { inserted: 0, unchanged: 0, held: 0 }
  const chunkSize = 200
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize)
    const { data, error } = await getSupabase().rpc('import_sabangnet_mall_urls', { p_brand_id: brandId, p_source_file: sourceFile, p_rows: chunk })
    if (error) throw new Error(`업체별 URL 저장 실패: ${error.message}. 이번 작업 ${result.inserted}건 등록 완료. 다시 저장하면 동일 URL은 건너뜁니다.`)
    const saved = data as typeof result
    result.inserted += saved.inserted; result.unchanged += saved.unchanged; result.held += saved.held
    onProgress?.(start + chunk.length, rows.length)
  }
  return result
}
