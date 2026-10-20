import { getSupabase } from '@/lib/supabase/client'
import {
  legacyUsageColumns,
  DEFAULT_USAGE_CODE_COLUMNS,
  type UsageCodeColumn,
} from '@/lib/codes/usage-code-columns'
/** Compatibility read for brand-wide headers. New writes use partner settings. */
export async function listUsageCodeColumns(
  brandId: string,
): Promise<UsageCodeColumn[]> {
  const { data, error } = await getSupabase()
    .from('usage_code_columns')
    .select('id,system_key,label,sort_order')
    .eq('brand_id', brandId)
    .order('sort_order')
  if (error) {
    console.warn('[usage-headers] 기존 헤더 조회 실패', {
      brandId,
      message: error.message,
    })
    throw new Error(error.message)
  }
  return data?.length
    ? legacyUsageColumns(data)
    : DEFAULT_USAGE_CODE_COLUMNS.map((column) => ({ ...column }))
}
