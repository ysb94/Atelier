import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  saveInvoiceItemNameRule,
  saveInvoiceItemNameRules,
  type InvoiceItemNameRuleInput,
} from '@/lib/api'
import { formatItemNameFromComponents } from '@/lib/invoice/item-name-transform'
import { itemNameRuleEditSave } from '@/lib/invoice/item-name-rule-manage'
import {
  INVOICE_ITEM_NAME_RULE_ACTION_LABEL,
  type InvoiceItemNameRule,
  type InvoiceItemNameRuleAction,
  type InvoiceItemNameRuleScope,
} from '@/lib/types'
import {
  InvoiceOptionExtrasEditor,
  completedOptionExtras,
  extrasFromRuleComponents,
  newOptionExtraDraft,
  type OptionExtraDraft,
} from './InvoiceOptionExtrasEditor'
import type { InvoiceItemNameLookupKeyRow } from './InvoiceItemNameLookupKeyTable'

function draftsFromRule(rule: InvoiceItemNameRule | null): OptionExtraDraft[] {
  return extrasFromRuleComponents(rule?.components ?? [])
}

function draftsForComponents(rule: InvoiceItemNameRule | null): OptionExtraDraft[] {
  const drafts = draftsFromRule(rule)
  return drafts.length > 0 ? drafts : [newOptionExtraDraft()]
}

export function InvoiceItemNameRuleForm({
  brandId,
  itemName,
  scope,
  existingRule,
  selectedRows = [],
  lockedLookupRule = null,
  onSaved,
  submitLabel,
}: {
  brandId: string
  itemName: string
  scope: Extract<InvoiceItemNameRuleScope, 'global' | 'lookup_key'>
  existingRule: InvoiceItemNameRule | null
  selectedRows?: InvoiceItemNameLookupKeyRow[]
  lockedLookupRule?: InvoiceItemNameRule | null
  onSaved?: () => void
  submitLabel?: string
}) {
  const queryClient = useQueryClient()
  const [action, setAction] = useState<InvoiceItemNameRuleAction>(
    existingRule?.action ?? 'delete',
  )
  const [extras, setExtras] = useState<OptionExtraDraft[]>(() =>
    draftsFromRule(existingRule),
  )
  const [savedMessage, setSavedMessage] = useState('')

  useEffect(() => {
    const nextAction = existingRule?.action ?? 'delete'
    setAction(nextAction)
    setExtras(
      nextAction === 'components'
        ? draftsForComponents(existingRule)
        : draftsFromRule(existingRule),
    )
    setSavedMessage('')
  }, [existingRule, itemName, lockedLookupRule?.id, scope])

  function selectAction(next: InvoiceItemNameRuleAction) {
    setAction(next)
    if (next === 'components') {
      setExtras((current) =>
        current.length > 0 ? current : [newOptionExtraDraft()],
      )
    }
  }

  const completed = completedOptionExtras(extras)
  const previewName =
    action === 'delete' ? '' : formatItemNameFromComponents(completed)
  const selectedCount = selectedRows.length
  const editingLookup = Boolean(lockedLookupRule)
  const canSave =
    Boolean(itemName.trim()) &&
    (scope === 'global' || editingLookup || selectedCount > 0) &&
    (action === 'delete' || completed.length > 0)

  const mutation = useMutation({
    mutationFn: async (input: InvoiceItemNameRuleInput) => {
      if (lockedLookupRule) {
        const saved = itemNameRuleEditSave(lockedLookupRule, {
          action: input.action,
          components: completed,
        })
        return saveInvoiceItemNameRule(brandId, saved.input, saved.ruleId)
      }
      if (scope === 'lookup_key') {
        return saveInvoiceItemNameRules(
          brandId,
          selectedRows.map((row) => ({
            input: {
              ...input,
              mainStyleId: row.style?.styleId ?? null,
              productLookupKey: row.productLookupKey,
            },
            ruleId: row.existingRule?.id,
          })),
        )
      }
      return saveInvoiceItemNameRule(brandId, input, existingRule?.id)
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: ['invoice-item-name-rules', brandId],
      })
      onSaved?.()
      if (lockedLookupRule) {
        setSavedMessage('저장했습니다. 현재 파일과 이후 작업에 바로 쓰입니다.')
        return
      }
      if (scope === 'lookup_key' && 'failed' in result) {
        const failed = result.failed
        const applied = result.applied.length
        if (failed.length === 0) {
          setSavedMessage(
            `선택 ${applied}건을 저장했습니다. 현재 파일과 이후 작업에 바로 쓰입니다.`,
          )
          return
        }
        const failedKeys = failed
          .map((item) => item.productLookupKey || '(조회 키 없음)')
          .join(', ')
        setSavedMessage(
          `${applied}건 저장, ${failed.length}건 실패. 실패: ${failedKeys}`,
        )
        return
      }
      setSavedMessage('저장했습니다. 현재 파일과 이후 작업에 바로 쓰입니다.')
    },
  })

  function submit() {
    if (!canSave) return
    setSavedMessage('')
    mutation.mutate({
      scope,
      mainStyleId: null,
      productLookupKey: null,
      itemName,
      action,
      components:
        action === 'components'
          ? completed.map((item) => ({
              styleId: item.style.styleId,
              role: item.role,
              quantity: item.quantity,
            }))
          : [],
    })
  }

  const bulkFailed =
    !editingLookup &&
    scope === 'lookup_key' &&
    mutation.data &&
    'failed' in mutation.data &&
    mutation.data.failed.length > 0
  const errorMessage =
    mutation.error instanceof Error
      ? mutation.error.message
      : mutation.error
        ? '내품명 규칙을 저장하지 못했습니다.'
        : ''

  return (
    <div className="space-y-3">
      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium">동작</legend>
        <div className="grid grid-cols-2 gap-1">
          {(['components', 'delete'] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={action === value ? 'default' : 'outline'}
              aria-pressed={action === value}
              onClick={() => selectAction(value)}
            >
              {INVOICE_ITEM_NAME_RULE_ACTION_LABEL[value]}
            </Button>
          ))}
        </div>
      </fieldset>

      {action === 'components' ? (
        <InvoiceOptionExtrasEditor
          brandId={brandId}
          extras={extras}
          onChange={setExtras}
          compact
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          구성품을 넣지 않고 최종 내품명을 빈칸으로 둡니다.
        </p>
      )}

      <div className="rounded-md border border-border px-2 py-1.5">
        <p className="text-xs text-muted-foreground">결과 내품명</p>
        <p className="break-words text-sm font-medium">
          {action === 'delete'
            ? '(빈 값)'
            : previewName || '구성품을 고르면 공식명이 보입니다'}
        </p>
      </div>

      {errorMessage ? (
        <p className="text-xs text-danger">{errorMessage}</p>
      ) : savedMessage ? (
        <p className={bulkFailed ? 'text-xs text-danger' : 'text-xs text-muted-foreground'}>
          {savedMessage}
        </p>
      ) : null}

      <Button
        type="button"
        size="sm"
        disabled={!canSave || mutation.isPending}
        onClick={submit}
      >
        <Save className="size-3.5" />
        {mutation.isPending
          ? '저장 중'
          : submitLabel
            ? submitLabel
            : editingLookup
              ? '수정 저장'
              : scope === 'lookup_key'
                ? `선택 ${selectedCount}건 적용`
                : '저장 후 다음'}
      </Button>
    </div>
  )
}
