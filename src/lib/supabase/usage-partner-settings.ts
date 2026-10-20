import { getSupabase } from '@/lib/supabase/client'
import { fetchAllPages } from '@/lib/supabase/paged-select'
import {
  DEFAULT_USAGE_CODE_COLUMNS,
  legacyUsageColumns,
  normalizeUsageColumns,
  usageColumnsError,
  type UsageCodeColumn,
  type UsagePrivateValue,
} from '@/lib/codes/usage-code-columns'

export type UsagePartnerAccess = {
  canRead: boolean
  canEdit: boolean
  canManage: boolean
  editorIds: string[]
}
export type UsagePartnerSettings = {
  columns: UsageCodeColumn[]
  access: UsagePartnerAccess
  ready: boolean
  source: 'partner' | 'legacy' | 'default'
}
export type UsagePartnerValue = {
  productCodeId: string
  fieldId: string
  value: UsagePrivateValue
}
type ColumnRow = {
  id: string
  kind: UsageCodeColumn['kind']
  source_key: UsageCodeColumn['sourceKey']
  label: string
  description: string
  value_type: UsageCodeColumn['valueType']
  visible: boolean
  sort_order: number
}
type StoreError = { code?: string; message?: string }
const deniedAccess: UsagePartnerAccess = {
  canRead: true,
  canEdit: false,
  canManage: false,
  editorIds: [],
}
const missingSchema = (error: StoreError | null) =>
  Boolean(
    error &&
    ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error.code ?? ''),
  )

function failure(
  action: string,
  error: StoreError,
  brandId: string,
  targetId?: string,
): never {
  console.warn('[usage-headers] ' + action, {
    brandId,
    targetId,
    code: error.code,
    message: error.message,
  })
  throw new Error(error.message || action)
}
const mapColumn = (row: ColumnRow): UsageCodeColumn => ({
  id: row.id,
  kind: row.kind,
  sourceKey: row.source_key,
  label: row.label,
  description: row.description,
  valueType: row.value_type,
  visible: row.visible,
  sortOrder: row.sort_order,
})

async function legacy(
  brandId: string,
): Promise<Pick<UsagePartnerSettings, 'columns' | 'source'>> {
  const { data, error } = await getSupabase()
    .from('usage_code_columns')
    .select('id,system_key,label,sort_order')
    .eq('brand_id', brandId)
    .order('sort_order')
  if (error && !missingSchema(error))
    failure('기존 헤더 조회 실패', error, brandId)
  if (error || !data?.length)
    return {
      columns: DEFAULT_USAGE_CODE_COLUMNS.map((c) => ({ ...c })),
      source: 'default',
    }
  return { columns: legacyUsageColumns(data), source: 'legacy' }
}

export async function getUsagePartnerSettings(
  brandId: string,
  targetId: string,
): Promise<UsagePartnerSettings> {
  const supabase = getSupabase()
  const [fields, access] = await Promise.all([
    supabase
      .from('usage_partner_columns')
      .select(
        'id,kind,source_key,label,description,value_type,visible,sort_order',
      )
      .eq('brand_id', brandId)
      .eq('usage_target_id', targetId)
      .order('sort_order')
      .order('id'),
    supabase.rpc('get_usage_partner_access', {
      p_brand_id: brandId,
      p_target_id: targetId,
    }),
  ])
  if (fields.error && !missingSchema(fields.error))
    failure('업체 헤더 조회 실패', fields.error, brandId, targetId)
  if (access.error && !missingSchema(access.error))
    failure('업체 담당 권한 조회 실패', access.error, brandId, targetId)
  if (fields.error || access.error) {
    console.warn('[usage-headers] 업체별 저장 준비 필요', { brandId, targetId })
    return {
      ...(await legacy(brandId)),
      access: { ...deniedAccess, editorIds: [] },
      ready: false,
    }
  }
  const permissions = access.data as UsagePartnerAccess | null
  if (
    !permissions ||
    typeof permissions.canEdit !== 'boolean' ||
    typeof permissions.canManage !== 'boolean' ||
    !Array.isArray(permissions.editorIds)
  ) {
    failure('업체 담당 권한을 확인하지 못했습니다.', {}, brandId, targetId)
  }
  return fields.data?.length
    ? {
        columns: normalizeUsageColumns(
          (fields.data as ColumnRow[]).map(mapColumn),
        ),
        source: 'partner',
        access: permissions,
        ready: true,
      }
    : { ...(await legacy(brandId)), access: permissions, ready: true }
}

export async function getUsagePartnerValues(
  brandId: string,
  targetId: string,
): Promise<UsagePartnerValue[]> {
  const rows = await fetchAllPages<{
    product_code_id: string
    field_id: string
    value: UsagePrivateValue
  }>({
    fetchPage: async (from, to, withCount) => {
      const result = await getSupabase()
        .from('usage_partner_values')
        .select(
          'product_code_id,field_id,value',
          withCount ? { count: 'exact' } : undefined,
        )
        .eq('brand_id', brandId)
        .eq('usage_target_id', targetId)
        .order('product_code_id')
        .order('field_id')
        .range(from, to)
      if (result.error)
        failure('업체 전용 값 조회 실패', result.error, brandId, targetId)
      return { rows: result.data ?? [], count: result.count ?? null }
    },
  })
  return rows.map((row) => ({
    productCodeId: row.product_code_id,
    fieldId: row.field_id,
    value: row.value,
  }))
}

export async function saveUsagePartnerColumns(
  brandId: string,
  targetId: string,
  columns: UsageCodeColumn[],
  previous: UsageCodeColumn[],
) {
  const next = normalizeUsageColumns(columns),
    problem = usageColumnsError(next, previous)
  if (problem) throw new Error(problem)
  const { error } = await getSupabase().rpc('save_usage_partner_columns', {
    p_brand_id: brandId,
    p_target_id: targetId,
    p_columns: next,
  })
  if (error) failure('업체 헤더 저장 실패', error, brandId, targetId)
}
export async function saveUsagePartnerValues(
  brandId: string,
  targetId: string,
  codeId: string,
  values: Record<string, UsagePrivateValue>,
) {
  const { error } = await getSupabase().rpc('save_usage_partner_values', {
    p_brand_id: brandId,
    p_target_id: targetId,
    p_code_id: codeId,
    p_values: values,
  })
  if (error) failure('업체 전용 값 저장 실패', error, brandId, targetId)
}
export async function getUsagePartnerManagerCandidates(
  brandId: string,
): Promise<Array<{ id: string; display_name: string | null }>> {
  const { data, error } = await getSupabase().rpc(
    'get_usage_partner_manager_candidates',
    { p_brand_id: brandId },
  )
  if (error) failure('담당자 목록 조회 실패', error, brandId)
  return data ?? []
}
export async function saveUsagePartnerEditors(
  brandId: string,
  targetId: string,
  profileIds: string[],
) {
  const { error } = await getSupabase().rpc('save_usage_partner_editors', {
    p_brand_id: brandId,
    p_target_id: targetId,
    p_profile_ids: profileIds,
  })
  if (error) failure('업체 담당자 저장 실패', error, brandId, targetId)
}
