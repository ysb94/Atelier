import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import {
  USAGE_SOURCE_LABELS,
  normalizeUsageColumns,
  usageColumnsError,
  type UsageCodeColumn,
  type UsageSourceKey,
  type UsageValueType,
  type UsagePrivateValue,
} from '@/lib/codes/usage-code-columns'
import { usageColumnText } from '@/lib/codes/usage-code-display'
import type { ProductCode, CodeUsageStatus } from '@/lib/types'

const kindLabels = {
  common: '🔒 공통 연결',
  private: '✏️ 업체 전용',
  operation: '업체 운영',
  legacy: '⚠️ 연결 확인 필요',
}
export function UsageCodeColumnDialog({
  partnerLabel,
  scopeOptions,
  scopeId,
  onChangeScope,
  columns,
  previewRows,
  styleNames,
  valueMap,
  readOnly,
  saving,
  onClose,
  onSave,
}: {
  partnerLabel: string
  scopeOptions?: Array<{ id: string; label: string }>
  scopeId?: string
  onChangeScope?: (id: string) => void
  columns: UsageCodeColumn[]
  previewRows: Array<{ code: ProductCode; status: CodeUsageStatus }>
  styleNames: ReadonlyMap<string, string>
  valueMap: Map<string, Record<string, UsagePrivateValue>>
  readOnly: boolean
  saving: boolean
  onClose: () => void
  onSave: (columns: UsageCodeColumn[]) => Promise<void>
}) {
  const [draft, setDraft] = useState(() => columns.map((c) => ({ ...c })))
  const [mode, setMode] = useState<'common' | 'private'>('common')
  const [source, setSource] = useState<UsageSourceKey>('productName')
  const [label, setLabel] = useState(''),
    [description, setDescription] = useState('')
  const [valueType, setValueType] = useState<UsageValueType>('text')
  const [error, setError] = useState<string | null>(null)
  const visible = draft.filter((c) => c.visible)
  const available = (
    Object.keys(USAGE_SOURCE_LABELS) as UsageSourceKey[]
  ).filter((key) => key !== 'status' && !draft.some((c) => c.sourceKey === key))
  function update(id: string, patch: Partial<UsageCodeColumn>) {
    setDraft((current) =>
      current.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    )
    setError(null)
  }
  function move(index: number, direction: number) {
    setDraft((current) => {
      const next = [...current]
      ;[next[index], next[index + direction]] = [
        next[index + direction],
        next[index],
      ]
      return next.map((c, i) => ({ ...c, sortOrder: i }))
    })
  }
  function add() {
    const selected = available.includes(source)
      ? source
      : (available[0] ?? 'productName')
    if (mode === 'common' && !available.length) {
      setError(
        '연결 가능한 공통 항목이 이미 모두 추가되어 있습니다. 숨긴 항목은 다시 표시하세요.',
      )
      return
    }
    if (mode === 'private' && !description.trim()) {
      setError('항목의 의미를 입력하세요.')
      return
    }
    const next: UsageCodeColumn[] = [
      ...draft,
      {
        id: crypto.randomUUID(),
        kind: mode,
        sourceKey: mode === 'common' ? selected : null,
        label: label.trim(),
        description:
          mode === 'common'
            ? USAGE_SOURCE_LABELS[selected]
            : description.trim(),
        valueType: mode === 'common' ? 'text' : valueType,
        visible: true,
        sortOrder: draft.length,
      },
    ]
    const problem = usageColumnsError(next, columns)
    if (problem) {
      setError(problem)
      return
    }
    setDraft(next)
    setLabel('')
    setDescription('')
    setError(null)
  }
  async function save() {
    const next = normalizeUsageColumns(draft),
      problem = usageColumnsError(next, columns)
    if (problem) {
      setError(problem)
      return
    }
    try {
      await onSave(next)
    } catch (cause) {
      console.warn('[usage-headers] 설정 저장 실패', {
        partnerLabel,
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
        aria-label="헤더 설정 닫기"
        disabled={saving}
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="표시 항목 및 연결 설정"
        className="relative flex max-h-[90vh] w-full max-w-6xl flex-col rounded-xl border border-border bg-card shadow-xl"
      >
        <header className="border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold">표시 항목 및 연결 설정</h2>
          <p className="mt-1 text-sm font-medium">{partnerLabel}</p>
          {scopeOptions && scopeOptions.length > 1 && onChangeScope ? (
            <label className="mt-2 block text-sm">
              기존 저장 연결
              <Select
                aria-label="헤더 저장 연결"
                value={scopeId}
                disabled={saving}
                onChange={(event) => {
                  if (
                    draft.some(
                      (field, index) =>
                        JSON.stringify(field) !==
                        JSON.stringify(columns[index]),
                    ) &&
                    !window.confirm(
                      '저장하지 않은 설정을 닫고 다른 연결을 확인할까요?',
                    )
                  )
                    return
                  onChangeScope(event.target.value)
                }}
              >
                {scopeOptions.map((scope) => (
                  <option key={scope.id} value={scope.id}>
                    {scope.label}
                  </option>
                ))}
              </Select>
              <span className="text-xs text-muted-foreground">
                목록은 업체로 묶어 보여주고, 헤더와 전용 값은 선택한 기존 연결에
                저장합니다.
              </span>
            </label>
          ) : null}
          <p className="mt-1 text-sm text-muted-foreground">
            이 업체의 담당자들이 같은 설정을 사용합니다. 다른 업체와 공통 원본은
            바뀌지 않습니다.
          </p>
          {readOnly ? (
            <p className="mt-2 text-sm">
              읽기 전용 · 이 업체에 편집 권한이 지정된 담당자만 수정할 수
              있습니다.
            </p>
          ) : null}
        </header>
        <div className="space-y-5 overflow-auto px-5 py-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th>순서</th>
                  <th>표시할 헤더명</th>
                  <th>항목 구분 / 값 출처</th>
                  <th>설명</th>
                  <th>표시</th>
                </tr>
              </thead>
              <tbody>
                {draft.map((column, index) => (
                  <tr
                    key={column.id}
                    className="border-b border-border align-top"
                  >
                    <td className="py-3 pr-2">
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={readOnly || saving || index === 0}
                          aria-label={`${column.label} 위로`}
                          onClick={() => move(index, -1)}
                        >
                          ↑
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={
                            readOnly || saving || index === draft.length - 1
                          }
                          aria-label={`${column.label} 아래로`}
                          onClick={() => move(index, 1)}
                        >
                          ↓
                        </Button>
                      </div>
                    </td>
                    <td className="min-w-44 py-3 pr-3">
                      <Input
                        aria-label={`${column.label} 표시 이름`}
                        value={column.label}
                        maxLength={40}
                        disabled={readOnly || saving}
                        onChange={(event) =>
                          update(column.id, { label: event.target.value })
                        }
                      />
                    </td>
                    <td className="max-w-64 py-3 pr-3">
                      <p>{kindLabels[column.kind]}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {column.sourceKey
                          ? USAGE_SOURCE_LABELS[column.sourceKey]
                          : column.kind === 'private'
                            ? `업체별 입력 · ${column.valueType === 'number' ? '숫자' : column.valueType === 'date' ? '날짜' : '텍스트'}`
                            : '기존 항목의 이름과 연결을 보존합니다.'}
                      </p>
                    </td>
                    <td className="min-w-48 py-3 pr-3">
                      <Input
                        aria-label={`${column.label} 설명`}
                        value={column.description}
                        maxLength={500}
                        disabled={readOnly || saving}
                        onChange={(event) =>
                          update(column.id, { description: event.target.value })
                        }
                      />
                    </td>
                    <td className="py-4">
                      <input
                        type="checkbox"
                        aria-label={`${column.label} 표시`}
                        checked={column.visible}
                        disabled={
                          readOnly ||
                          saving ||
                          column.sourceKey === 'code' ||
                          column.sourceKey === 'status'
                        }
                        onChange={(event) =>
                          update(column.id, { visible: event.target.checked })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            헤더명은 표시 이름입니다. 연결·입력 형식은 유지되며, 항목은 삭제
            대신 숨길 수 있습니다. 88코드와 상태는 필수입니다.
          </p>
          {!readOnly ? (
            <section className="rounded-lg border border-border p-4">
              <h3 className="mb-3 font-medium">항목 추가</h3>
              <div className="mb-3 flex gap-2">
                <Button
                  type="button"
                  variant={mode === 'common' ? 'default' : 'outline'}
                  disabled={saving}
                  onClick={() => setMode('common')}
                >
                  기존 정보 연결
                </Button>
                <Button
                  type="button"
                  variant={mode === 'private' ? 'default' : 'outline'}
                  disabled={saving}
                  onClick={() => setMode('private')}
                >
                  업체 전용 항목
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {mode === 'common' ? (
                  <label className="text-sm">
                    가져올 정보
                    <Select
                      aria-label="가져올 정보"
                      className="mt-1 w-full"
                      value={
                        available.includes(source)
                          ? source
                          : (available[0] ?? '')
                      }
                      disabled={saving || !available.length}
                      onChange={(event) =>
                        setSource(event.target.value as UsageSourceKey)
                      }
                    >
                      {!available.length ? (
                        <option value="">
                          모든 공통 항목이 추가되었습니다
                        </option>
                      ) : (
                        available.map((key) => (
                          <option key={key} value={key}>
                            {USAGE_SOURCE_LABELS[key]}
                          </option>
                        ))
                      )}
                    </Select>
                  </label>
                ) : (
                  <label className="text-sm">
                    입력 형식
                    <Select
                      aria-label="입력 형식"
                      className="mt-1 w-full"
                      value={valueType}
                      disabled={saving}
                      onChange={(event) =>
                        setValueType(event.target.value as UsageValueType)
                      }
                    >
                      <option value="text">텍스트</option>
                      <option value="number">숫자</option>
                      <option value="date">날짜</option>
                    </Select>
                  </label>
                )}
                <label className="text-sm">
                  표시할 헤더명
                  <Input
                    aria-label="새 헤더 이름"
                    className="mt-1"
                    value={label}
                    disabled={saving}
                    maxLength={40}
                    placeholder="예: 상품명"
                    onChange={(event) => setLabel(event.target.value)}
                  />
                </label>
                {mode === 'private' ? (
                  <label className="text-sm">
                    항목의 의미
                    <Input
                      aria-label="새 항목의 의미"
                      className="mt-1"
                      value={description}
                      disabled={saving}
                      maxLength={500}
                      placeholder="예: 무신사 판매 상품명"
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </label>
                ) : (
                  <p className="self-end text-xs text-muted-foreground">
                    공통 정보는 연결해서 보여주며 값을 수정하지 않습니다.
                  </p>
                )}
              </div>
              <Button
                type="button"
                className="mt-3"
                variant="outline"
                disabled={saving}
                onClick={add}
              >
                항목 추가
              </Button>
            </section>
          ) : null}
          <section>
            <h3 className="mb-2 font-medium">실제 표 미리보기</h3>
            {previewRows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      {visible.map((column) => (
                        <th
                          key={column.id}
                          className="border-b border-border p-2"
                        >
                          {column.label}{' '}
                          {column.kind === 'common'
                            ? '🔒'
                            : column.kind === 'private'
                              ? '✏️'
                              : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.slice(0, 3).map((row) => (
                      <tr key={row.code.id}>
                        {visible.map((column) => (
                          <td
                            key={column.id}
                            className="whitespace-pre-line border-b border-border p-2 align-top"
                          >
                            {usageColumnText(
                              column,
                              row.code,
                              row.status,
                              styleNames,
                              valueMap.get(row.code.id),
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                등록된 코드를 선택하면 실제 값으로 미리 볼 수 있습니다.
              </p>
            )}
          </section>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={onClose}
          >
            닫기
          </Button>
          {!readOnly ? (
            <Button type="button" disabled={saving} onClick={() => void save()}>
              {saving ? '저장 중…' : '이 업체에 설정 저장'}
            </Button>
          ) : null}
        </footer>
      </section>
    </div>
  )
}
