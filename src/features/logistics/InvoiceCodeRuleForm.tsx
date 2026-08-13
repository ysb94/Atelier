import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { StylePicker } from '@/components/style-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { saveInvoiceCodeRule, type InvoiceCodeRuleInput } from '@/lib/api'
import type { StyleRef } from '@/lib/types'

export function InvoiceCodeRuleForm({
  brandId,
  initialCode = '',
  lockCode = false,
  onSaved,
}: {
  brandId: string
  initialCode?: string
  lockCode?: boolean
  onSaved?: () => void
}) {
  const queryClient = useQueryClient()
  const [ownProductCode, setOwnProductCode] = useState(initialCode)
  const [targetStyle, setTargetStyle] = useState<StyleRef | null>(null)
  const [isException, setIsException] = useState(false)
  const [note, setNote] = useState('')
  const [savedMessage, setSavedMessage] = useState('')

  const canSave =
    Boolean(ownProductCode.trim()) && (isException || Boolean(targetStyle))

  function toggleException() {
    setSavedMessage('')
    setIsException((current) => {
      const next = !current
      if (next) setTargetStyle(null)
      return next
    })
  }

  const mutation = useMutation({
    mutationFn: (input: InvoiceCodeRuleInput) =>
      saveInvoiceCodeRule(brandId, input),
    onSuccess: async (rule) => {
      await queryClient.invalidateQueries({
        queryKey: ['invoice-name-rules', brandId],
      })
      setSavedMessage(
        rule.action === 'rename'
          ? `${rule.sourceValue} → ${rule.targetStyleNo ?? ''} ${rule.targetName ?? ''}`.trim()
          : `${rule.sourceValue} 코드를 예외로 저장했습니다.`,
      )
      if (!lockCode) setOwnProductCode('')
      setTargetStyle(null)
      setIsException(false)
      setNote('')
      onSaved?.()
    },
  })

  function submit() {
    if (!canSave) return
    setSavedMessage('')
    mutation.mutate({
      ownProductCode,
      action: isException ? 'exception' : 'rename',
      targetStyle: isException ? undefined : (targetStyle ?? undefined),
      note,
    })
  }

  const errorMessage =
    mutation.error instanceof Error ? mutation.error.message : null

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1.6fr_1fr]">
        <div>
          <label
            htmlFor={`invoice-code-${initialCode}`}
            className="mb-1.5 block text-xs font-medium"
          >
            자체품번코드
          </label>
          <Input
            id={`invoice-code-${initialCode}`}
            value={ownProductCode}
            readOnly={lockCode}
            onChange={(event) => setOwnProductCode(event.target.value)}
            placeholder="자체품번코드 입력"
            className={lockCode ? 'bg-muted/40 font-medium' : undefined}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium">
            상품업체 상품명(업체 공식)
          </label>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              {isException ? (
                <Input
                  disabled
                  value=""
                  placeholder="예외 · 원본 품목명 유지"
                  className="bg-muted/40"
                />
              ) : (
                <StylePicker
                  brandId={brandId}
                  value={targetStyle}
                  onChange={(next) => {
                    setTargetStyle(next)
                    setSavedMessage('')
                  }}
                  placeholder="M번호 또는 상품명 검색"
                />
              )}
            </div>
            <Button
              type="button"
              size="sm"
              variant={isException ? 'default' : 'outline'}
              aria-pressed={isException}
              className="shrink-0"
              onClick={toggleException}
            >
              예외
            </Button>
          </div>
        </div>
        <div>
          <label
            htmlFor={`invoice-code-note-${initialCode}`}
            className="mb-1.5 block text-xs font-medium"
          >
            메모{' '}
            <span className="font-normal text-muted-foreground">(선택)</span>
          </label>
          <Input
            id={`invoice-code-note-${initialCode}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="등록 또는 예외 처리 이유"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          disabled={mutation.isPending || !canSave}
          onClick={submit}
        >
          <Save className="size-4" />
          {mutation.isPending ? '저장 중...' : '저장'}
        </Button>
      </div>

      {errorMessage ? (
        <p className="text-xs text-danger">{errorMessage}</p>
      ) : savedMessage ? (
        <p className="text-xs text-success">{savedMessage}</p>
      ) : null}
    </div>
  )
}
