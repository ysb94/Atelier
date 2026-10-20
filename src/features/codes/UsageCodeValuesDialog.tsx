import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  parseUsageValue,
  type UsageCodeColumn,
  type UsagePrivateValue,
} from '@/lib/codes/usage-code-columns'
import type { ProductCode } from '@/lib/types'

export function UsageCodeValuesDialog({
  partnerLabel,
  code,
  columns,
  values,
  saving,
  onClose,
  onSave,
}: {
  partnerLabel: string
  code: ProductCode
  columns: UsageCodeColumn[]
  values: Record<string, UsagePrivateValue>
  saving: boolean
  onClose: () => void
  onSave: (values: Record<string, UsagePrivateValue>) => Promise<void>
}) {
  const fields = columns.filter(
    (column) => column.kind === 'private' && column.visible,
  )
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((column) => [
        column.id,
        values[column.id] == null ? '' : String(values[column.id]),
      ]),
    ),
  )
  const [error, setError] = useState<string | null>(null)
  async function save() {
    try {
      const next = Object.fromEntries(
        fields.map((column) => [
          column.id,
          parseUsageValue(column, draft[column.id] ?? ''),
        ]),
      )
      await onSave(next)
    } catch (cause) {
      console.warn('[usage-headers] 업체 전용 값 저장 실패', {
        codeId: code.id,
        message: String(cause),
      })
      setError(cause instanceof Error ? cause.message : '저장하지 못했습니다.')
    }
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !saving) onClose()
      }}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="업체 전용 값 닫기"
        disabled={saving}
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="업체 전용 값 수정"
        className="relative flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-border bg-card shadow-xl"
      >
        <header className="border-b border-border p-5">
          <h2 className="font-semibold">업체 전용 값 수정</h2>
          <p className="mt-1 text-sm font-medium">{partnerLabel}</p>
          <p className="mt-2 text-sm">
            🔒 {code.code} · {code.name}
          </p>
          <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
            {code.components
              .map((c) => `${c.styleNo}${c.qty > 1 ? ` ×${c.qty}` : ''}`)
              .join(' / ')}{' '}
            · 공통 원본은 변경하지 않습니다.
          </p>
        </header>
        <div className="space-y-4 overflow-auto p-5">
          {fields.map((column) => (
            <label key={column.id} className="block text-sm">
              <span className="font-medium">{column.label}</span>
              <p className="mb-1 text-xs text-muted-foreground">
                {column.description}
              </p>
              <Input
                aria-label={`${column.label} 업체 전용 값`}
                type={column.valueType === 'date' ? 'date' : 'text'}
                inputMode={
                  column.valueType === 'number' ? 'decimal' : undefined
                }
                value={draft[column.id] ?? ''}
                disabled={saving}
                maxLength={4000}
                onChange={(event) => {
                  setError(null)
                  setDraft((current) => ({
                    ...current,
                    [column.id]: event.target.value,
                  }))
                }}
              />
            </label>
          ))}
          {!fields.length ? (
            <p>
              표시 중인 업체 전용 항목이 없습니다. 헤더 설정에서 추가하세요.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-border p-4">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={onClose}
          >
            닫기
          </Button>
          <Button
            type="button"
            disabled={saving || !fields.length}
            onClick={() => void save()}
          >
            {saving ? '저장 중…' : '업체 전용 값 저장'}
          </Button>
        </footer>
      </section>
    </div>
  )
}
