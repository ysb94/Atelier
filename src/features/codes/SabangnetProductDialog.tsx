import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import {
  parseSabangnetNumber,
  sabangnetFieldLabel,
} from '@/lib/codes/sabangnet-fields'
import { resolveStyleNosToIds } from '@/lib/codes/sabangnet-import'
import type {
  SabangnetField,
  SabangnetProduct,
  SabangnetProductInput,
  StyleRef,
} from '@/lib/types'

export type SabangnetProductDialogMode = 'create' | 'edit'

type SabangnetProductDialogProps = {
  open: boolean
  mode: SabangnetProductDialogMode
  source?: SabangnetProduct | null
  existingProducts: SabangnetProduct[]
  styles: StyleRef[]
  fields?: SabangnetField[]
  isSubmitting?: boolean
  errorMessage?: string | null
  onClose: () => void
  onSubmit: (input: SabangnetProductInput) => void | Promise<void>
}

export function SabangnetProductDialog({
  open,
  mode,
  source,
  existingProducts,
  styles,
  fields = [],
  isSubmitting,
  errorMessage,
  onClose,
  onSubmit,
}: SabangnetProductDialogProps) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [styleText, setStyleText] = useState('')
  const [extras, setExtras] = useState<Record<string, string>>({})
  const [localError, setLocalError] = useState<string | null>(null)
  const customFields = useMemo(
    () => fields.filter((field) => field.systemKey === null),
    [fields],
  )
  const codeLabel = sabangnetFieldLabel(fields, 'code', '사방넷 코드')
  const nameLabel = sabangnetFieldLabel(fields, 'name', '사방넷 상품명')
  const stylesLabel = sabangnetFieldLabel(fields, 'styles', 'M번호 리스트')

  useEffect(() => {
    if (!open) return
    setCode(source?.code ?? '')
    setName(source?.name ?? '')
    setStyleText(source?.styles.map((style) => style.styleNo).join(', ') ?? '')
    const nextExtras: Record<string, string> = {}
    for (const field of fields) {
      if (field.systemKey) continue
      nextExtras[field.id] = source?.values?.[field.id] ?? ''
    }
    setExtras(nextExtras)
    setLocalError(null)
  }, [open, source, fields])

  const duplicate = useMemo(() => {
    const trimmed = code.trim()
    if (!trimmed) return null
    return (
      existingProducts.find(
        (product) =>
          product.code.trim() === trimmed && product.id !== source?.id,
      ) ?? null
    )
  }, [code, existingProducts, source?.id])

  if (!open) return null

  function handleSubmit() {
    const nextCode = code.trim()
    const nextName = name.trim()
    if (!nextCode) {
      setLocalError('사방넷 코드를 입력하세요.')
      return
    }
    if (!nextName) {
      setLocalError('사방넷 상품명을 입력하세요.')
      return
    }
    if (duplicate) {
      setLocalError(`이미 등록된 사방넷 코드입니다. (${duplicate.name})`)
      return
    }

    const values = { ...(source?.values ?? {}) }
    for (const field of customFields) {
      const rawValue = (extras[field.id] ?? '').trim()
      if (!rawValue) {
        delete values[field.id]
        continue
      }
      if (field.type === 'number') {
        const parsed = parseSabangnetNumber(rawValue, field.label)
        if (parsed.error) {
          setLocalError(parsed.error)
          return
        }
        if (parsed.value) values[field.id] = parsed.value
        continue
      }
      values[field.id] = rawValue
    }

    const raw = styleText.trim()
    if (!raw) {
      void onSubmit({ code: nextCode, name: nextName, styleIds: [], values })
      return
    }

    const resolved = resolveStyleNosToIds({ raw, styles })
    if (resolved.error) {
      setLocalError(resolved.error)
      return
    }
    void onSubmit({
      code: nextCode,
      name: nextName,
      styleIds: resolved.styleIds,
      values,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="닫기"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        disabled={isSubmitting}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sabangnet-product-title"
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2
              id="sabangnet-product-title"
              className="text-base font-semibold tracking-tight"
            >
              {mode === 'edit' ? '사방넷 코드 수정' : '사방넷 코드 등록'}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              품번코드·상품명과 SKU 단위 M번호를 저장합니다. 수량은 넣지
              않습니다.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="닫기"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{codeLabel}</span>
            <Input
              value={code}
              placeholder="품번코드"
              disabled={isSubmitting}
              onChange={(event) => {
                setCode(event.target.value)
                setLocalError(null)
              }}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{nameLabel}</span>
            <Input
              value={name}
              placeholder="사방넷 상품명"
              disabled={isSubmitting}
              onChange={(event) => {
                setName(event.target.value)
                setLocalError(null)
              }}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{stylesLabel}</span>
            <Textarea
              rows={3}
              value={styleText}
              placeholder="쉼표로 M번호 입력"
              disabled={isSubmitting}
              onChange={(event) => {
                setStyleText(event.target.value)
                setLocalError(null)
              }}
            />
            <span className="block text-xs text-muted-foreground">
              쉼표 또는 줄바꿈. 비우면 미연결로 등록합니다.
            </span>
          </label>
          {customFields.map((field) => (
            <label key={field.id} className="block space-y-1.5">
              <span className="text-sm font-medium">
                {field.label}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  {field.type === 'number' ? '숫자' : '텍스트'}
                </span>
              </span>
              <Input
                value={extras[field.id] ?? ''}
                disabled={isSubmitting}
                inputMode={field.type === 'number' ? 'decimal' : undefined}
                onChange={(event) => {
                  setExtras((current) => ({
                    ...current,
                    [field.id]: event.target.value,
                  }))
                  setLocalError(null)
                }}
              />
            </label>
          ))}

          {localError || errorMessage ? (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {localError ?? errorMessage}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            취소
          </Button>
          <Button
            type="button"
            disabled={isSubmitting}
            onClick={handleSubmit}
          >
            {isSubmitting ? '저장 중...' : '저장'}
          </Button>
        </div>
      </div>
    </div>
  )
}
