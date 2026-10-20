import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  normalizeUsageCodeColumns,
  usageCodeColumnError,
  usageCodeColumnLocked,
  type UsageCodeColumn,
} from '@/lib/codes/usage-code-columns'

export function UsageCodeColumnDialog({
  columns,
  saving,
  saveError,
  onClose,
  onSave,
}: {
  columns: UsageCodeColumn[]
  saving: boolean
  saveError?: string | null
  onClose: () => void
  onSave: (columns: UsageCodeColumn[]) => void
}) {
  const [draft, setDraft] = useState(() => normalizeUsageCodeColumns(columns))
  const [label, setLabel] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  function commit(next: UsageCodeColumn[]) {
    const normalized = normalizeUsageCodeColumns(next)
    const problem = usageCodeColumnError(normalized)
    if (problem) {
      setError(problem)
      return false
    }
    setError(null)
    setDraft(normalized)
    return true
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="헤더 설정 닫기" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative z-10 flex max-h-[min(80vh,40rem)] w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-lg">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">표 헤더 설정</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            여기서 정한 헤더가 목록과 양식 다운로드에 같이 나옵니다. 88코드와 상태는 빼지 않습니다.
          </p>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-auto px-4 py-3">
          {draft.map((column, index) => (
            <div key={column.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
              {editingId === column.id ? (
                <>
                  <Input
                    aria-label="헤더 이름"
                    value={editLabel}
                    onChange={(event) => setEditLabel(event.target.value)}
                  />
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)}>취소</Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      if (commit(draft.map((item) => item.id === column.id ? { ...item, label: editLabel } : item))) {
                        setEditingId(null)
                      }
                    }}
                  >
                    저장
                  </Button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{column.label}</span>
                  <Button type="button" size="sm" variant="ghost" disabled={index === 0} onClick={() => {
                    const next = [...draft]
                    const [item] = next.splice(index, 1)
                    next.splice(index - 1, 0, item)
                    commit(next.map((column, order) => ({ ...column, sortOrder: order })))
                  }}>위로</Button>
                  <Button type="button" size="sm" variant="ghost" disabled={index === draft.length - 1} onClick={() => {
                    const next = [...draft]
                    const [item] = next.splice(index, 1)
                    next.splice(index + 1, 0, item)
                    commit(next.map((column, order) => ({ ...column, sortOrder: order })))
                  }}>아래로</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => { setEditingId(column.id); setEditLabel(column.label) }}>수정</Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="text-danger"
                    disabled={usageCodeColumnLocked(column)}
                    onClick={() => commit(draft.filter((item) => item.id !== column.id))}
                  >
                    삭제
                  </Button>
                </>
              )}
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <Input
              aria-label="새 헤더 이름"
              placeholder="새 헤더 이름"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const name = label.trim()
                if (!name) {
                  setError('헤더 이름을 입력하세요.')
                  return
                }
                if (commit([
                  ...draft,
                  { id: crypto.randomUUID(), systemKey: null, label: name, sortOrder: draft.length },
                ])) {
                  setLabel('')
                }
              }}
            >
              추가
            </Button>
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {saveError ? <p className="text-sm text-danger">{saveError}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button type="button" variant="outline" onClick={onClose}>닫기</Button>
          <Button type="button" disabled={saving} onClick={() => onSave(draft)}>
            {saving ? '저장 중...' : '헤더 저장'}
          </Button>
        </div>
      </div>
    </div>
  )
}
