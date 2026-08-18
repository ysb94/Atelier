import type {
  InvoiceItemNameRule,
  InvoiceItemNameRuleAction,
  InvoiceItemNameRuleComponent,
  InvoiceItemNameRuleScope,
  InvoiceOptionComponentRole,
  StyleRef,
} from '@/lib/types'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage, isUniqueViolation } from '@/lib/supabase/map-error'

const RULE_COLUMNS =
  'id, brand_id, scope, main_style_id, item_name, normalized_item_name, action, is_active, note, created_at, updated_at'
const COMPONENT_EMBED =
  'invoice_item_name_rule_components(id, rule_id, style_id, role, quantity, sort_order, styles!invoice_item_name_rule_components_style_fkey(id, style_no, name))'
const MAIN_STYLE_EMBED =
  'styles!invoice_item_name_rules_main_style_fkey(id, style_no, name)'
const RULE_SELECT = `${RULE_COLUMNS}, ${MAIN_STYLE_EMBED}, ${COMPONENT_EMBED}`
const PAGE_SIZE = 1000

type StyleEmbed = {
  id: string
  style_no: string
  name: string
}

type ComponentRow = {
  id: string
  rule_id: string
  style_id: string
  role: string
  quantity: number
  sort_order: number
  styles?: StyleEmbed | StyleEmbed[] | null
}

type RuleRow = {
  id: string
  brand_id: string
  scope: string
  main_style_id: string | null
  item_name: string
  normalized_item_name: string
  action: string
  is_active: boolean
  note: string
  created_at: string
  updated_at: string
  styles?: StyleEmbed | StyleEmbed[] | null
  invoice_item_name_rule_components?: ComponentRow[] | null
}

export class InvoiceItemNameRuleStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoiceItemNameRuleStoreError'
  }
}

function styleFromEmbed(
  embed: StyleEmbed | StyleEmbed[] | null | undefined,
): StyleEmbed | null {
  if (!embed) return null
  return Array.isArray(embed) ? (embed[0] ?? null) : embed
}

function toStyleRef(embed: StyleEmbed): StyleRef {
  return {
    styleId: embed.id,
    styleNo: embed.style_no,
    name: embed.name,
  }
}

function parseComponentRole(
  value: string,
): InvoiceItemNameRuleComponent['role'] | null {
  if (value === 'included' || value === 'required' || value === 'paid_add') {
    return value
  }
  return null
}

function parseScope(value: string): InvoiceItemNameRuleScope | null {
  if (value === 'global' || value === 'main_style') return value
  return null
}

function parseAction(value: string): InvoiceItemNameRuleAction | null {
  if (value === 'delete' || value === 'components') return value
  return null
}

function toComponent(row: ComponentRow): InvoiceItemNameRuleComponent | null {
  const role = parseComponentRole(row.role)
  const style = styleFromEmbed(row.styles)
  if (!role || !style) return null
  return {
    id: row.id,
    ruleId: row.rule_id,
    style: toStyleRef(style),
    role,
    quantity: row.quantity,
    sortOrder: row.sort_order,
  }
}

function toRule(row: RuleRow): InvoiceItemNameRule | null {
  const scope = parseScope(row.scope)
  const action = parseAction(row.action)
  if (!scope || !action) return null
  const mainStyle = styleFromEmbed(row.styles)
  if (scope === 'main_style' && !mainStyle) return null
  const components = [...(row.invoice_item_name_rule_components ?? [])]
    .map(toComponent)
    .filter((item): item is InvoiceItemNameRuleComponent => Boolean(item))
    .sort((left, right) => left.sortOrder - right.sortOrder)
  return {
    id: row.id,
    brandId: row.brand_id,
    scope,
    mainStyle: mainStyle ? toStyleRef(mainStyle) : null,
    itemName: row.item_name,
    normalizedItemName: row.normalized_item_name,
    action,
    isActive: row.is_active,
    note: row.note,
    components,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export type InvoiceItemNameRuleComponentInput = {
  styleId: string
  role: Exclude<InvoiceOptionComponentRole, 'main'>
  quantity: number
}

export type InvoiceItemNameRuleInput = {
  scope: InvoiceItemNameRuleScope
  mainStyleId?: string | null
  itemName: string
  action: InvoiceItemNameRuleAction
  isActive?: boolean
  note?: string
  components?: InvoiceItemNameRuleComponentInput[]
}

function validateInput(input: InvoiceItemNameRuleInput) {
  const itemName = input.itemName.trim()
  if (!itemName) {
    throw new InvoiceItemNameRuleStoreError('내품명을 입력하세요.')
  }
  if (input.scope === 'main_style' && !input.mainStyleId?.trim()) {
    throw new InvoiceItemNameRuleStoreError(
      '본품별 규칙은 확정된 본품 M번호가 필요합니다.',
    )
  }
  if (input.scope === 'global' && input.mainStyleId?.trim()) {
    throw new InvoiceItemNameRuleStoreError(
      '공통 규칙에는 본품 M번호를 넣지 않습니다.',
    )
  }
  const components = input.components ?? []
  if (input.action === 'components' && components.length === 0) {
    throw new InvoiceItemNameRuleStoreError('구성품 M번호를 하나 이상 고르세요.')
  }
  if (input.action === 'delete' && components.length > 0) {
    throw new InvoiceItemNameRuleStoreError(
      '지우는 규칙에는 구성품을 넣지 않습니다.',
    )
  }
  const seenStyleIds = new Set<string>()
  for (const item of components) {
    if (!item.styleId) {
      throw new InvoiceItemNameRuleStoreError('구성품 M번호를 고르세요.')
    }
    if (seenStyleIds.has(item.styleId)) {
      throw new InvoiceItemNameRuleStoreError(
        '같은 구성품 M번호는 한 번만 넣을 수 있습니다.',
      )
    }
    seenStyleIds.add(item.styleId)
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new InvoiceItemNameRuleStoreError('구성 수량은 1 이상이어야 합니다.')
    }
  }
}

function payloadFromInput(brandId: string, input: InvoiceItemNameRuleInput) {
  const itemName = input.itemName.trim()
  const mainStyleId =
    input.scope === 'main_style' ? input.mainStyleId?.trim() || null : null
  return {
    brand_id: brandId,
    scope: input.scope,
    main_style_id: mainStyleId,
    item_name: itemName,
    normalized_item_name: normalizeInvoiceText(itemName),
    action: input.action,
    is_active: input.isActive ?? true,
    note: input.note?.trim() ?? '',
  }
}

async function replaceComponents(
  brandId: string,
  ruleId: string,
  components: InvoiceItemNameRuleComponentInput[],
) {
  const supabase = getSupabase()
  const { error: deleteError } = await supabase
    .from('invoice_item_name_rule_components')
    .delete()
    .eq('rule_id', ruleId)
  if (deleteError) {
    throw new InvoiceItemNameRuleStoreError(
      errorMessage(deleteError, '구성품을 바꾸지 못했습니다.'),
    )
  }
  if (components.length === 0) return
  const { error: insertError } = await supabase
    .from('invoice_item_name_rule_components')
    .insert(
      components.map((item, index) => ({
        brand_id: brandId,
        rule_id: ruleId,
        style_id: item.styleId,
        role: item.role,
        quantity: item.quantity,
        sort_order: index,
      })),
    )
  if (insertError) {
    throw new InvoiceItemNameRuleStoreError(
      errorMessage(insertError, '구성품을 저장하지 못했습니다.'),
    )
  }
}

async function fetchRule(id: string): Promise<InvoiceItemNameRule> {
  const { data, error } = await getSupabase()
    .from('invoice_item_name_rules')
    .select(RULE_SELECT)
    .eq('id', id)
    .single()
  if (error || !data) {
    throw new InvoiceItemNameRuleStoreError(
      errorMessage(error, '내품명 규칙을 불러오지 못했습니다.'),
    )
  }
  const rule = toRule(data as RuleRow)
  if (!rule) {
    throw new InvoiceItemNameRuleStoreError('내품명 규칙을 읽지 못했습니다.')
  }
  return rule
}

export async function listInvoiceItemNameRules(
  brandId: string,
  options: { activeOnly?: boolean } = {},
): Promise<InvoiceItemNameRule[]> {
  const supabase = getSupabase()
  const all: InvoiceItemNameRule[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('invoice_item_name_rules')
      .select(RULE_SELECT)
      .eq('brand_id', brandId)
      .order('updated_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (options.activeOnly) query = query.eq('is_active', true)
    const { data, error } = await query
    if (error) {
      throw new InvoiceItemNameRuleStoreError(
        errorMessage(error, '내품명 규칙을 불러오지 못했습니다.'),
      )
    }
    const rows = ((data as RuleRow[]) ?? [])
      .map(toRule)
      .filter((item): item is InvoiceItemNameRule => Boolean(item))
    all.push(...rows)
    if (((data as RuleRow[]) ?? []).length < PAGE_SIZE) break
  }
  return all
}

export async function saveInvoiceItemNameRule(
  brandId: string,
  input: InvoiceItemNameRuleInput,
  ruleId?: string,
): Promise<InvoiceItemNameRule> {
  validateInput(input)
  const supabase = getSupabase()
  const payload = payloadFromInput(brandId, input)

  let existingQuery = supabase
    .from('invoice_item_name_rules')
    .select('id')
    .eq('brand_id', brandId)
    .eq('scope', payload.scope)
    .eq('normalized_item_name', payload.normalized_item_name)
    .eq('is_active', true)
  existingQuery = payload.main_style_id
    ? existingQuery.eq('main_style_id', payload.main_style_id)
    : existingQuery.is('main_style_id', null)
  const { data: existing, error: existingError } = await existingQuery.maybeSingle()
  if (existingError) {
    throw new InvoiceItemNameRuleStoreError(
      errorMessage(existingError, '내품명 규칙을 확인하지 못했습니다.'),
    )
  }

  const targetId = ruleId || existing?.id || null
  const writer = targetId
    ? supabase.from('invoice_item_name_rules').update(payload).eq('id', targetId)
    : supabase.from('invoice_item_name_rules').insert(payload)

  const { data, error } = await writer.select('id').single()
  if (error || !data) {
    if (isUniqueViolation(error ?? {})) {
      throw new InvoiceItemNameRuleStoreError(
        payload.scope === 'global'
          ? '같은 내품명 공통 규칙이 이미 있습니다.'
          : '같은 본품·내품명 규칙이 이미 있습니다.',
      )
    }
    throw new InvoiceItemNameRuleStoreError(
      errorMessage(error, '내품명 규칙을 저장하지 못했습니다.'),
    )
  }

  const savedId = (data as { id: string }).id
  await replaceComponents(brandId, savedId, input.components ?? [])
  return fetchRule(savedId)
}
