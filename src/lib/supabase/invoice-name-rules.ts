import type {
  InvoiceNameRule,
  InvoiceNameRuleAction,
  InvoiceNameRuleMatchType,
  StyleRef,
} from '@/lib/types'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage } from '@/lib/supabase/map-error'
import { fetchAllPages } from '@/lib/supabase/paged-select'

const COLUMNS =
  'id, brand_id, match_type, source_value, normalized_source_value, action, target_style_id, target_name, is_active, is_test, note, created_at, updated_at'

const SELECT_WITH_STYLE = `${COLUMNS}, styles!invoice_name_rules_target_style_fkey(id, style_no, name)`

type StyleEmbed = {
  id: string
  style_no: string
  name: string
} | null

type InvoiceNameRuleRow = {
  id: string
  brand_id: string
  match_type: InvoiceNameRuleMatchType
  source_value: string
  normalized_source_value: string
  action: InvoiceNameRuleAction
  target_style_id: string | null
  target_name: string | null
  is_active: boolean
  is_test: boolean
  note: string
  created_at: string
  updated_at: string
  styles?: StyleEmbed | StyleEmbed[] | null
}

export class InvoiceNameRuleStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoiceNameRuleStoreError'
  }
}

function embedStyle(row: InvoiceNameRuleRow): StyleEmbed {
  const embed = row.styles
  if (Array.isArray(embed)) return embed[0] ?? null
  return embed ?? null
}

function toRule(row: InvoiceNameRuleRow): InvoiceNameRule {
  const style = embedStyle(row)
  const targetStyleId = row.target_style_id
  return {
    id: row.id,
    brandId: row.brand_id,
    matchType: row.match_type,
    sourceValue: row.source_value,
    normalizedSourceValue: row.normalized_source_value,
    action: row.action,
    targetStyleId,
    targetStyleNo: style?.style_no ?? null,
    // 연결된 상품이 있으면 현재 이름, 없으면 스냅샷(예외·구 데이터 대비)
    targetName:
      style?.name ??
      (targetStyleId ? null : row.target_name),
    isActive: row.is_active,
    isTest: row.is_test,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const RULE_PAGE_SIZE = 1000

export async function listInvoiceNameRules(
  brandId: string,
  options: { activeOnly?: boolean } = {},
): Promise<InvoiceNameRule[]> {
  const rows = await fetchAllPages<InvoiceNameRuleRow>({
    pageSize: RULE_PAGE_SIZE,
    fetchPage: async (from, to, withCount) => {
      let query = getSupabase()
        .from('invoice_name_rules')
        .select(SELECT_WITH_STYLE, withCount ? { count: 'exact' } : undefined)
        .eq('brand_id', brandId)
        .order('match_type', { ascending: true })
        .order('source_value', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
      if (options.activeOnly) query = query.eq('is_active', true)
      const { data, error, count } = await query
      if (error) {
        throw new InvoiceNameRuleStoreError(
          errorMessage(error, '송장 이름변경 규칙을 불러오지 못했습니다.'),
        )
      }
      return {
        rows: (data as InvoiceNameRuleRow[]) ?? [],
        count: count ?? null,
      }
    },
  })
  return rows.map(toRule)
}

export type InvoiceCodeRuleInput = {
  ownProductCode: string
  action: InvoiceNameRuleAction
  targetStyle?: StyleRef
  note?: string
}

function normalizeCode(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR')
}

/** 같은 자체품번코드는 공식명 등록과 예외 처리를 서로 바꿔 저장할 수 있다. */
export async function saveInvoiceCodeRule(
  brandId: string,
  input: InvoiceCodeRuleInput,
): Promise<InvoiceNameRule> {
  const sourceValue = input.ownProductCode.trim()
  if (!sourceValue) {
    throw new InvoiceNameRuleStoreError('자체품번코드를 입력하세요.')
  }
  if (input.action === 'rename') {
    if (!input.targetStyle?.styleId) {
      throw new InvoiceNameRuleStoreError(
        '데이터 시트 상품(M번호)을 고르세요.',
      )
    }
  }

  const supabase = getSupabase()
  const { data: existing, error: readError } = await supabase
    .from('invoice_name_rules')
    .select('id')
    .eq('brand_id', brandId)
    .eq('match_type', 'own_product_code')
    .eq('normalized_source_value', normalizeCode(sourceValue))
    .maybeSingle()

  if (readError) {
    throw new InvoiceNameRuleStoreError(
      errorMessage(readError, '기존 자체품번코드 기준을 확인하지 못했습니다.'),
    )
  }

  const payload = {
    brand_id: brandId,
    match_type: 'own_product_code' as const,
    source_value: sourceValue,
    action: input.action,
    target_style_id:
      input.action === 'rename' ? input.targetStyle!.styleId : null,
    target_name:
      input.action === 'rename' ? input.targetStyle!.name.trim() : null,
    is_active: true,
    is_test: false,
    note: input.note?.trim() ?? '',
  }

  const query = existing
    ? supabase
        .from('invoice_name_rules')
        .update(payload)
        .eq('id', (existing as { id: string }).id)
    : supabase.from('invoice_name_rules').insert(payload)
  const { data, error } = await query.select(SELECT_WITH_STYLE).single()

  if (error) {
    throw new InvoiceNameRuleStoreError(
      errorMessage(error, '자체품번코드 기준을 저장하지 못했습니다.'),
    )
  }
  return toRule(data as InvoiceNameRuleRow)
}

export type InvoiceNameRuleUpdateInput = {
  action: InvoiceNameRuleAction
  targetStyle?: StyleRef
  note?: string
  isActive: boolean
}

/** 자체품번코드는 그대로 두고 처리·공식 상품·메모·상태만 고친다. */
export async function updateInvoiceNameRule(
  id: string,
  input: InvoiceNameRuleUpdateInput,
): Promise<InvoiceNameRule> {
  if (input.action === 'rename' && !input.targetStyle?.styleId) {
    throw new InvoiceNameRuleStoreError(
      '데이터 시트 상품(M번호)을 고르세요.',
    )
  }

  const payload = {
    action: input.action,
    target_style_id:
      input.action === 'rename' ? input.targetStyle!.styleId : null,
    target_name:
      input.action === 'rename' ? input.targetStyle!.name.trim() : null,
    is_active: input.isActive,
    note: input.note?.trim() ?? '',
  }

  const { data, error } = await getSupabase()
    .from('invoice_name_rules')
    .update(payload)
    .eq('id', id)
    .select(SELECT_WITH_STYLE)
    .single()

  if (error) {
    throw new InvoiceNameRuleStoreError(
      errorMessage(error, '자체품번코드 기준을 수정하지 못했습니다.'),
    )
  }
  return toRule(data as InvoiceNameRuleRow)
}
