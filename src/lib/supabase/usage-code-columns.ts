import { getSupabase } from '@/lib/supabase/client'
import {
  DEFAULT_USAGE_CODE_COLUMNS,
  isUsageCodeSystemKey,
  normalizeUsageCodeColumns,
  usageCodeColumnError,
  type UsageCodeColumn,
  type UsageCodeSystemKey,
} from '@/lib/codes/usage-code-columns'

type ColumnRow = {
  id: string
  system_key: string | null
  label: string
  sort_order: number
}

function mapRow(row: ColumnRow): UsageCodeColumn {
  return {
    id: row.id,
    systemKey: isUsageCodeSystemKey(row.system_key) ? row.system_key : null,
    label: row.label,
    sortOrder: row.sort_order,
  }
}

export async function listUsageCodeColumns(brandId: string): Promise<UsageCodeColumn[]> {
  const { data, error } = await getSupabase()
    .from('usage_code_columns')
    .select('id, system_key, label, sort_order')
    .eq('brand_id', brandId)
    .order('sort_order')
    .order('label')
  if (error) {
    console.warn('[usage-codes] 헤더 조회 실패', { brandId, message: error.message })
    throw new Error(error.message)
  }
  const columns = (data as ColumnRow[]).map(mapRow)
  if (columns.length > 0) return normalizeUsageCodeColumns(columns)
  return saveUsageCodeColumns(
    brandId,
    DEFAULT_USAGE_CODE_COLUMNS.map((column) => ({
      ...column,
      id: crypto.randomUUID(),
    })),
  )
}

export async function saveUsageCodeColumns(
  brandId: string,
  columns: UsageCodeColumn[],
): Promise<UsageCodeColumn[]> {
  const next = normalizeUsageCodeColumns(columns)
  const problem = usageCodeColumnError(next)
  if (problem) throw new Error(problem)
  const supabase = getSupabase()
  const { data, error } = await supabase.rpc('replace_usage_code_columns', {
    p_brand_id: brandId,
    p_columns: next.map((column) => ({
      id: column.id,
      systemKey: column.systemKey,
      label: column.label,
      sortOrder: column.sortOrder,
    })),
  })
  if (error) {
    console.warn('[usage-codes] 헤더 저장 실패', { brandId, message: error.message })
    throw new Error(error.message)
  }
  return normalizeUsageCodeColumns(((data ?? []) as ColumnRow[]).map(mapRow))
}

export type { UsageCodeSystemKey }
