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
import { errorMessage, isMissingRpc, isUniqueViolation } from '@/lib/supabase/map-error'
import { fetchAllPages } from '@/lib/supabase/paged-select'

const RULE_COLUMNS =
  'id, brand_id, scope, main_style_id, item_name, normalized_item_name, product_lookup_key, normalized_product_lookup_key, action, is_active, note, created_at, updated_at'
const LOOKUP_SAVE_CONCURRENCY = 4
const COMPONENT_EMBED =
  'invoice_item_name_rule_components(id, rule_id, style_id, role, quantity, sort_order, styles!invoice_item_name_rule_components_style_fkey(id, style_no, name))'
const MAIN_STYLE_EMBED =
  'styles!invoice_item_name_rules_main_style_fkey(id, style_no, name)'
const RULE_SELECT = `${RULE_COLUMNS}, ${MAIN_STYLE_EMBED}, ${COMPONENT_EMBED}`
const PAGE_SIZE = 1000
const LOOKUP_CHUNK = 400

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
  product_lookup_key: string
  normalized_product_lookup_key: string
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
  if (value === 'global' || value === 'main_style' || value === 'lookup_key') {
    return value
  }
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
  if ((scope === 'main_style' || scope === 'lookup_key') && !mainStyle) {
    return null
  }
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
    productLookupKey: row.product_lookup_key ?? '',
    normalizedProductLookupKey: row.normalized_product_lookup_key ?? '',
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

export type InvoiceItemNameRuleFeedback = {
  source: 'manual' | 'local' | 'ai'
  cacheId?: string | null
  provider?: string | null
  modelId?: string | null
  suggestedAction?: 'delete' | 'components' | null
  suggestedComponents?: Array<{ styleId: string; quantity: number }>
  outcome?: 'confirmed' | 'corrected'
}

export type InvoiceItemNameRuleInput = {
  scope: InvoiceItemNameRuleScope
  mainStyleId?: string | null
  productLookupKey?: string | null
  itemName: string
  action: InvoiceItemNameRuleAction
  isActive?: boolean
  note?: string
  components?: InvoiceItemNameRuleComponentInput[]
}

export type InvoiceItemNameRuleBulkFailure = {
  scope: InvoiceItemNameRuleScope
  itemName: string
  productLookupKey: string
  mainStyleId: string
  message: string
}

export type InvoiceItemNameRuleBulkResult = {
  applied: InvoiceItemNameRule[]
  failed: InvoiceItemNameRuleBulkFailure[]
}

function validateInput(input: InvoiceItemNameRuleInput) {
  const itemName = input.itemName.trim()
  if (!itemName) {
    throw new InvoiceItemNameRuleStoreError('내품명을 입력하세요.')
  }
  if (
    (input.scope === 'main_style' || input.scope === 'lookup_key') &&
    !input.mainStyleId?.trim()
  ) {
    throw new InvoiceItemNameRuleStoreError(
      input.scope === 'lookup_key'
        ? '조회 키 규칙은 확정된 본품 M번호가 필요합니다.'
        : '본품별 규칙은 확정된 본품 M번호가 필요합니다.',
    )
  }
  if (input.scope === 'lookup_key' && !input.productLookupKey?.trim()) {
    throw new InvoiceItemNameRuleStoreError('조회 키를 입력하세요.')
  }
  if (input.scope === 'global' && input.mainStyleId?.trim()) {
    throw new InvoiceItemNameRuleStoreError(
      '공통 규칙에는 본품 M번호를 넣지 않습니다.',
    )
  }
  if (input.scope !== 'lookup_key' && input.productLookupKey?.trim()) {
    throw new InvoiceItemNameRuleStoreError(
      '공통·본품별 규칙에는 조회 키를 넣지 않습니다.',
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
    input.scope === 'global' ? null : input.mainStyleId?.trim() || null
  const productLookupKey =
    input.scope === 'lookup_key' ? input.productLookupKey?.trim() || '' : ''
  return {
    brand_id: brandId,
    scope: input.scope,
    main_style_id: mainStyleId,
    item_name: itemName,
    normalized_item_name: normalizeInvoiceText(itemName),
    product_lookup_key: productLookupKey,
    normalized_product_lookup_key: normalizeInvoiceText(productLookupKey),
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

function chunked<T>(items: T[], size = LOOKUP_CHUNK): T[][] {
  const out: T[][] = []
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size))
  }
  return out
}

async function listInvoiceItemNameRulesByIds(
  ids: string[],
): Promise<InvoiceItemNameRule[]> {
  if (ids.length === 0) return []
  const supabase = getSupabase()
  const byId = new Map<string, InvoiceItemNameRule>()
  for (const chunk of chunked(ids, 200)) {
    const { data, error } = await supabase
      .from('invoice_item_name_rules')
      .select(RULE_SELECT)
      .in('id', chunk)
    if (error) {
      throw new InvoiceItemNameRuleStoreError(
        errorMessage(error, '내품명 규칙을 불러오지 못했습니다.'),
      )
    }
    for (const row of (data as RuleRow[]) ?? []) {
      const rule = toRule(row)
      if (rule) byId.set(rule.id, rule)
    }
  }
  return [...byId.values()]
}

export async function listInvoiceItemNameRulesForItemNames(
  brandId: string,
  itemNames: string[],
): Promise<InvoiceItemNameRule[]> {
  const unique = [
    ...new Set(itemNames.map((text) => text.trim()).filter(Boolean)),
  ]
  if (unique.length === 0) return []
  const supabase = getSupabase()
  const byId = new Map<string, InvoiceItemNameRule>()
  try {
    for (const chunk of chunked(unique)) {
      const { data, error } = await supabase.rpc(
        'list_invoice_item_name_rule_ids_for_names',
        {
          p_brand_id: brandId,
          p_item_names: chunk,
        },
      )
      if (error) {
        if (isMissingRpc(error)) {
          return listInvoiceItemNameRules(brandId, { activeOnly: true })
        }
        throw new InvoiceItemNameRuleStoreError(
          errorMessage(error, '내품명 규칙을 불러오지 못했습니다.'),
        )
      }
      const ids = ((data as Array<{ id: string }> | null) ?? []).map(
        (row) => row.id,
      )
      for (const rule of await listInvoiceItemNameRulesByIds(ids)) {
        byId.set(rule.id, rule)
      }
    }
    return [...byId.values()]
  } catch (error) {
    if (isMissingRpc(error as { code?: string; message?: string })) {
      return listInvoiceItemNameRules(brandId, { activeOnly: true })
    }
    throw error
  }
}

export async function listInvoiceItemNameRules(
  brandId: string,
  options: { activeOnly?: boolean } = {},
): Promise<InvoiceItemNameRule[]> {
  const supabase = getSupabase()
  const rows = await fetchAllPages<RuleRow>({
    pageSize: PAGE_SIZE,
    fetchPage: async (from, to, withCount) => {
      let query = supabase
        .from('invoice_item_name_rules')
        .select(RULE_SELECT, withCount ? { count: 'exact' } : undefined)
        .eq('brand_id', brandId)
        .order('updated_at', { ascending: false })
        .range(from, to)
      if (options.activeOnly) query = query.eq('is_active', true)
      const { data, error, count } = await query
      if (error) {
        throw new InvoiceItemNameRuleStoreError(
          errorMessage(error, '내품명 규칙을 불러오지 못했습니다.'),
        )
      }
      return { rows: (data as RuleRow[]) ?? [], count: count ?? null }
    },
  })
  return rows
    .map(toRule)
    .filter((item): item is InvoiceItemNameRule => Boolean(item))
}

export async function saveInvoiceItemNameRule(
  brandId: string,
  input: InvoiceItemNameRuleInput,
  ruleId?: string,
  feedback?: InvoiceItemNameRuleFeedback,
): Promise<InvoiceItemNameRule> {
  validateInput(input)
  const supabase = getSupabase()
  const payload = payloadFromInput(brandId, input)
  if (feedback) {
    const { data: savedId, error: saveError } = await supabase.rpc(
      'save_invoice_item_name_rule_with_feedback',
      {
        p_brand_id: brandId,
        p_row: {
          ...payload,
          components: (input.components ?? []).map((item) => ({
            styleId: item.styleId,
            role: item.role,
            quantity: item.quantity,
          })),
        },
        p_rule_id: ruleId ?? null,
        p_feedback: {
          source: feedback.source,
          cache_id: feedback.cacheId ?? null,
          provider: feedback.provider ?? null,
          model_id: feedback.modelId ?? null,
          suggested_action: feedback.suggestedAction ?? null,
          suggested_components: feedback.suggestedComponents ?? [],
          outcome: feedback.outcome ?? 'confirmed',
        },
      },
    )
    if (saveError || !savedId) {
      if (isUniqueViolation(saveError ?? {})) {
        throw new InvoiceItemNameRuleStoreError(
          payload.scope === 'global'
            ? '같은 내품명 공통 규칙이 이미 있습니다.'
            : payload.scope === 'lookup_key'
              ? '같은 본품·조회 키·내품명 규칙이 이미 있습니다.'
              : '같은 본품·내품명 규칙이 이미 있습니다.',
        )
      }
      throw new InvoiceItemNameRuleStoreError(
        errorMessage(saveError, '내품명 규칙을 저장하지 못했습니다.'),
      )
    }
    return fetchRule(String(savedId))
  }

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
  existingQuery =
    payload.scope === 'lookup_key'
      ? existingQuery.eq(
          'normalized_product_lookup_key',
          payload.normalized_product_lookup_key,
        )
      : existingQuery.eq('normalized_product_lookup_key', '')
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
          : payload.scope === 'lookup_key'
            ? '같은 본품·조회 키·내품명 규칙이 이미 있습니다.'
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

export async function setInvoiceItemNameRuleActive(
  id: string,
  isActive: boolean,
): Promise<InvoiceItemNameRule> {
  const { error } = await getSupabase()
    .from('invoice_item_name_rules')
    .update({ is_active: isActive })
    .eq('id', id)
  if (error) {
    throw new InvoiceItemNameRuleStoreError(
      errorMessage(error, '내품명 규칙 활성 상태를 바꾸지 못했습니다.'),
    )
  }
  return fetchRule(id)
}

export async function saveInvoiceItemNameRules(
  brandId: string,
  items: Array<{
    input: InvoiceItemNameRuleInput
    ruleId?: string
    feedback?: InvoiceItemNameRuleFeedback
  }>,
  options: { concurrency?: number } = {},
): Promise<InvoiceItemNameRuleBulkResult> {
  const concurrency = Math.max(
    1,
    Math.min(options.concurrency ?? LOOKUP_SAVE_CONCURRENCY, 8),
  )
  const applied: InvoiceItemNameRule[] = []
  const failed: InvoiceItemNameRuleBulkFailure[] = []
  let cursor = 0

  async function worker() {
    while (cursor < items.length) {
      const current = items[cursor]
      cursor += 1
      if (!current) continue
      try {
        applied.push(
          await saveInvoiceItemNameRule(
            brandId,
            current.input,
            current.ruleId,
            current.feedback,
          ),
        )
      } catch (error) {
        failed.push({
          scope: current.input.scope,
          itemName: current.input.itemName,
          productLookupKey: current.input.productLookupKey?.trim() ?? '',
          mainStyleId: current.input.mainStyleId?.trim() ?? '',
          message:
            error instanceof Error ? error.message : '저장하지 못했습니다.',
        })
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length || 1) }, () =>
      worker(),
    ),
  )
  return { applied, failed }
}
