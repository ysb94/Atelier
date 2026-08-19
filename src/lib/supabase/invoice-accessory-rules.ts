import type {
  InvoiceAccessoryRule,
  InvoiceAccessoryRuleType,
  StyleRef,
} from '@/lib/types'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'

const RULE_COLUMNS =
  'id, brand_id, rule_type, pattern, normalized_pattern, accessory_kind, name_prefix, color_name, target_style_id, is_active, note, created_at, updated_at'
const STYLE_EMBED =
  'styles!invoice_accessory_rules_target_style_id_fkey(id, style_no, name)'
const RULE_SELECT = `${RULE_COLUMNS}, ${STYLE_EMBED}`
const PAGE_SIZE = 1000
const RULE_TYPES = new Set<InvoiceAccessoryRuleType>([
  'label',
  'color',
  'token',
  'ignore',
  'default',
])

type StyleEmbed = {
  id: string
  style_no: string
  name: string
}

type RuleRow = {
  id: string
  brand_id: string
  rule_type: string
  pattern: string
  normalized_pattern: string
  accessory_kind: string
  name_prefix: string
  color_name: string
  target_style_id: string | null
  is_active: boolean
  note: string
  created_at: string
  updated_at: string
  styles?: StyleEmbed | StyleEmbed[] | null
}

export class InvoiceAccessoryRuleStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoiceAccessoryRuleStoreError'
  }
}

export type InvoiceAccessoryRuleInput = {
  ruleType: InvoiceAccessoryRuleType
  pattern: string
  accessoryKind?: string
  namePrefix?: string
  colorName?: string
  targetStyleId?: string | null
  isActive?: boolean
  note?: string
}

function styleFromEmbed(
  embed: StyleEmbed | StyleEmbed[] | null | undefined,
): StyleRef | null {
  if (!embed) return null
  const row = Array.isArray(embed) ? (embed[0] ?? null) : embed
  if (!row) return null
  return { styleId: row.id, styleNo: row.style_no, name: row.name }
}

function parseType(value: string): InvoiceAccessoryRuleType | null {
  return RULE_TYPES.has(value as InvoiceAccessoryRuleType)
    ? (value as InvoiceAccessoryRuleType)
    : null
}

function toRule(row: RuleRow): InvoiceAccessoryRule | null {
  const ruleType = parseType(row.rule_type)
  if (!ruleType) return null
  const targetStyle = styleFromEmbed(row.styles)
  if (ruleType === 'token' && !targetStyle) return null
  return {
    id: row.id,
    brandId: row.brand_id,
    ruleType,
    pattern: row.pattern,
    normalizedPattern: row.normalized_pattern,
    accessoryKind: row.accessory_kind,
    namePrefix: row.name_prefix,
    colorName: row.color_name,
    targetStyle,
    isActive: row.is_active,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function validateInput(input: InvoiceAccessoryRuleInput) {
  if (!RULE_TYPES.has(input.ruleType)) {
    throw new InvoiceAccessoryRuleStoreError('지원하지 않는 사전 종류입니다.')
  }
  if (!input.pattern.trim()) {
    throw new InvoiceAccessoryRuleStoreError('패턴을 입력하세요.')
  }
  if (input.ruleType === 'label' || input.ruleType === 'default') {
    if (!input.accessoryKind?.trim() || !input.namePrefix?.trim()) {
      throw new InvoiceAccessoryRuleStoreError(
        '부속품 종류와 상품명 접두어를 입력하세요.',
      )
    }
  }
  if (input.ruleType === 'color' && !input.colorName?.trim()) {
    throw new InvoiceAccessoryRuleStoreError('한글 색상을 입력하세요.')
  }
  if (input.ruleType === 'token' && !input.targetStyleId?.trim()) {
    throw new InvoiceAccessoryRuleStoreError('연결할 구성품을 고르세요.')
  }
}

function payloadFromInput(brandId: string, input: InvoiceAccessoryRuleInput) {
  const ruleType = input.ruleType
  return {
    brand_id: brandId,
    rule_type: ruleType,
    pattern: input.pattern.trim(),
    normalized_pattern: normalizeInvoiceText(input.pattern),
    accessory_kind:
      ruleType === 'label' || ruleType === 'default'
        ? input.accessoryKind?.trim() ?? ''
        : '',
    name_prefix:
      ruleType === 'label' || ruleType === 'default'
        ? input.namePrefix?.trim() ?? ''
        : '',
    color_name: ruleType === 'color' ? input.colorName?.trim() ?? '' : '',
    target_style_id:
      ruleType === 'token' ? input.targetStyleId?.trim() || null : null,
    is_active: input.isActive ?? true,
    note: input.note?.trim() ?? '',
  }
}

export async function listInvoiceAccessoryRules(
  brandId: string,
  options: { activeOnly?: boolean } = {},
): Promise<InvoiceAccessoryRule[]> {
  const supabase = getSupabase()
  const all: InvoiceAccessoryRule[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('invoice_accessory_rules')
      .select(RULE_SELECT)
      .eq('brand_id', brandId)
      .order('rule_type')
      .order('pattern')
      .range(from, from + PAGE_SIZE - 1)
    if (options.activeOnly) query = query.eq('is_active', true)
    const { data, error } = await query
    if (error) {
      throw new InvoiceAccessoryRuleStoreError(
        errorMessage(error, '부속품 사전을 불러오지 못했습니다.'),
      )
    }
    all.push(
      ...((data as RuleRow[]) ?? [])
        .map(toRule)
        .filter((item): item is InvoiceAccessoryRule => Boolean(item)),
    )
    if ((data ?? []).length < PAGE_SIZE) break
  }
  return all
}

export async function saveInvoiceAccessoryRule(
  brandId: string,
  input: InvoiceAccessoryRuleInput,
  ruleId?: string,
): Promise<InvoiceAccessoryRule> {
  validateInput(input)
  const supabase = getSupabase()
  const payload = payloadFromInput(brandId, input)

  let existingId = ruleId
  if (!existingId) {
    const { data: exact, error: exactError } = await supabase
      .from('invoice_accessory_rules')
      .select('id')
      .eq('brand_id', brandId)
      .eq('rule_type', payload.rule_type)
      .eq('normalized_pattern', payload.normalized_pattern)
      .maybeSingle()
    if (exactError) {
      throw new InvoiceAccessoryRuleStoreError(
        errorMessage(exactError, '부속품 사전을 확인하지 못했습니다.'),
      )
    }
    existingId = exact?.id
  }

  const writer = existingId
    ? supabase
        .from('invoice_accessory_rules')
        .update(payload)
        .eq('id', existingId)
    : supabase.from('invoice_accessory_rules').insert(payload)

  const { data, error } = await writer.select(RULE_SELECT).single()
  if (error || !data) {
    if (isUniqueViolation(error ?? {})) {
      throw new InvoiceAccessoryRuleStoreError('같은 패턴이 이미 있습니다.')
    }
    throw new InvoiceAccessoryRuleStoreError(
      errorMessage(error, '부속품 사전을 저장하지 못했습니다.'),
    )
  }
  const rule = toRule(data as RuleRow)
  if (!rule) {
    throw new InvoiceAccessoryRuleStoreError('저장한 사전을 읽지 못했습니다.')
  }
  return rule
}

export async function saveInvoiceAccessoryRules(
  brandId: string,
  items: InvoiceAccessoryRuleInput[],
): Promise<{ applied: InvoiceAccessoryRule[]; failed: string[] }> {
  const applied: InvoiceAccessoryRule[] = []
  const failed: string[] = []
  for (const input of items) {
    try {
      applied.push(await saveInvoiceAccessoryRule(brandId, input))
    } catch (error) {
      failed.push(
        `${input.pattern}: ${
          error instanceof Error ? error.message : '저장하지 못했습니다.'
        }`,
      )
    }
  }
  return { applied, failed }
}

export async function setInvoiceAccessoryRuleActive(
  id: string,
  isActive: boolean,
): Promise<InvoiceAccessoryRule> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('invoice_accessory_rules')
    .update({ is_active: isActive })
    .eq('id', id)
    .select(RULE_SELECT)
    .single()
  if (error || !data) {
    throw new InvoiceAccessoryRuleStoreError(
      errorMessage(error, '부속품 사전 상태를 바꾸지 못했습니다.'),
    )
  }
  const rule = toRule(data as RuleRow)
  if (!rule) {
    throw new InvoiceAccessoryRuleStoreError('바꾼 사전을 읽지 못했습니다.')
  }
  return rule
}

export async function deleteInvoiceAccessoryRule(id: string): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase
    .from('invoice_accessory_rules')
    .delete()
    .eq('id', id)
  if (error) {
    throw new InvoiceAccessoryRuleStoreError(
      errorMessage(error, '부속품 사전을 지우지 못했습니다.'),
    )
  }
}
