import { formatItemNameFromComponents } from '@/lib/invoice/item-name-transform'
import type { InvoiceItemNameRuleInput } from '@/lib/supabase/invoice-item-name-rules'
import type {
  InvoiceItemNameRule,
  InvoiceItemNameRuleAction,
  InvoiceItemNameRuleComponent,
} from '@/lib/types'

export function listLookupKeyItemNameRules(rules: InvoiceItemNameRule[]) {
  return rules
    .filter((rule) => rule.scope === 'lookup_key')
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.itemName.localeCompare(right.itemName, 'ko-KR') ||
        left.productLookupKey.localeCompare(right.productLookupKey, 'ko-KR'),
    )
}

export function formatItemNameRuleResult(
  rule: Pick<InvoiceItemNameRule, 'action' | 'components'>,
) {
  if (rule.action === 'delete') return '(빈 값)'
  return formatItemNameFromComponents(rule.components) || '(구성품 없음)'
}

export function formatItemNameRuleStyleNos(
  rule: Pick<InvoiceItemNameRule, 'action' | 'components'>,
) {
  if (rule.action === 'delete' || rule.components.length === 0) return '-'
  return rule.components
    .map((item) => {
      const quantity = Math.max(1, Math.floor(item.quantity || 1))
      return quantity > 1
        ? `${item.style.styleNo}×${quantity}`
        : item.style.styleNo
    })
    .join(', ')
}

export function itemNameRuleSearchText(rule: InvoiceItemNameRule) {
  return [
    rule.itemName,
    rule.productLookupKey,
    rule.mainStyle?.styleNo ?? '',
    rule.mainStyle?.name ?? '',
    formatItemNameRuleResult(rule),
    formatItemNameRuleStyleNos(rule),
    rule.note,
  ].join(' ')
}

export function itemNameRuleEditSave(
  rule: InvoiceItemNameRule,
  next: {
    action: InvoiceItemNameRuleAction
    components?: Array<Pick<InvoiceItemNameRuleComponent, 'style' | 'quantity'>>
  },
): { ruleId: string; input: InvoiceItemNameRuleInput } {
  const components =
    next.action === 'components'
      ? (next.components ?? []).map((item) => ({
          styleId: item.style.styleId,
          role: 'included' as const,
          quantity: Math.max(1, Math.floor(item.quantity || 1)),
        }))
      : []
  return {
    ruleId: rule.id,
    input: {
      scope: rule.scope,
      mainStyleId: rule.mainStyle?.styleId ?? null,
      productLookupKey: rule.productLookupKey,
      itemName: rule.itemName,
      action: next.action,
      isActive: rule.isActive,
      note: rule.note,
      components,
    },
  }
}
