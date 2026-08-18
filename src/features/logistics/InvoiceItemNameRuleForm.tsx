import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { formatStyleRef } from '@/components/style-picker'
import { Button } from '@/components/ui/button'
import {
  saveInvoiceItemNameRule,
  type InvoiceItemNameRuleInput,
} from '@/lib/api'
import { formatItemNameFromComponents } from '@/lib/invoice/item-name-transform'
import {
  INVOICE_ITEM_NAME_RULE_ACTION_LABEL,
  INVOICE_ITEM_NAME_RULE_SCOPE_LABEL,
  type InvoiceItemNameRule,
  type InvoiceItemNameRuleAction,
  type InvoiceItemNameRuleScope,
  type StyleRef,
} from '@/lib/types'
import {
  InvoiceOptionExtrasEditor,
  completedOptionExtras,
  extrasFromRuleComponents,
  type OptionExtraDraft,
} from './InvoiceOptionExtrasEditor'

function draftsFromRule(rule: InvoiceItemNameRule | null): OptionExtraDraft[] {
  return extrasFromRuleComponents(rule?.components ?? [])
}

export function InvoiceItemNameRuleForm({
  brandId,
  itemName,
  scope,
  onScopeChange,
  mainStyle,
  existingRule,
}: {
  brandId: string
  itemName: string
  scope: InvoiceItemNameRuleScope
  onScopeChange: (scope: InvoiceItemNameRuleScope) => void
  mainStyle: StyleRef | null
  existingRule: InvoiceItemNameRule | null
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
    setAction(existingRule?.action ?? 'delete')
    setExtras(draftsFromRule(existingRule))
    setSavedMessage('')
  }, [existingRule, itemName, mainStyle?.styleId, scope])

  const completed = completedOptionExtras(extras)
  const previewName =
    action === 'delete' ? '' : formatItemNameFromComponents(completed)
  const canSave =
    Boolean(itemName.trim()) &&
    (scope === 'global' || Boolean(mainStyle)) &&
    (action === 'delete' || completed.length > 0)

  const mutation = useMutation({
    mutationFn: (input: InvoiceItemNameRuleInput) =>
      saveInvoiceItemNameRule(brandId, input, existingRule?.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['invoice-item-name-rules', brandId],
      })
      setSavedMessage('저장했습니다. 현재 파일과 이후 작업에 바로 쓰입니다.')
    },
  })

  function submit() {
    if (!canSave) return
    setSavedMessage('')
    mutation.mutate({
      scope,
      mainStyleId: scope === 'main_style' ? mainStyle?.styleId : null,
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

  const errorMessage =
    mutation.error instanceof Error
      ? mutation.error.message
      : mutation.error
        ? '내품명 규칙을 저장하지 못했습니다.'
        : ''

  return (
    <div className="space-y-3">
      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium">적용 범위</legend>
        <div className="grid grid-cols-2 gap-1">
          {(['global', 'main_style'] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={scope === value ? 'default' : 'outline'}
              aria-pressed={scope === value}
              onClick={() => onScopeChange(value)}
            >
              {INVOICE_ITEM_NAME_RULE_SCOPE_LABEL[value]}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {scope === 'global'
            ? '쇼핑몰과 품목명을 보지 않고 이 브랜드의 같은 내품명에 모두 적용합니다.'
            : '앞에서 확정한 본품 M번호마다 따로 저장합니다.'}
        </p>
      </fieldset>

      {scope === 'main_style' ? (
        <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
          <p className="text-xs text-muted-foreground">확정 본품</p>
          <p className="text-sm font-medium">
            {mainStyle ? formatStyleRef(mainStyle) : '본품이 아직 확정되지 않았습니다'}
          </p>
        </div>
      ) : null}

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
              onClick={() => setAction(value)}
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
        <p className="text-xs text-muted-foreground">{savedMessage}</p>
      ) : null}

      <Button
        type="button"
        size="sm"
        disabled={!canSave || mutation.isPending}
        onClick={submit}
      >
        <Save className="size-3.5" />
        {mutation.isPending ? '저장 중' : '저장 후 다음'}
      </Button>
    </div>
  )
}
