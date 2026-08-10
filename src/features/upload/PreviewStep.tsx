import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { FIELD_MAP } from '@/lib/import/fields'
import { ROW_ACTION_HEADER } from '@/lib/import/row-keys'
import type { PreparedRow } from '@/lib/import/transform'
import { cn, formatNumber } from '@/lib/utils'

type Filter = 'all' | 'new' | 'update' | 'delete' | 'error'

type PreviewStepProps = {
  rows: PreparedRow[]
  isApplying: boolean
  emptyMeans: 'keep' | 'clear'
  onEmptyMeansChange: (next: 'keep' | 'clear') => void
  onBack: () => void
  onApply: () => void
}

const FILTER_LABEL: Record<Filter, string> = {
  all: '전체',
  new: '신규',
  update: '업데이트',
  delete: '삭제',
  error: '오류',
}

export function PreviewStep({
  rows,
  isApplying,
  emptyMeans,
  onEmptyMeansChange,
  onBack,
  onApply,
}: PreviewStepProps) {
  const [filter, setFilter] = useState<Filter>('all')
  const [deleteConfirm, setDeleteConfirm] = useState('')

  const counts = {
    all: rows.length,
    new: rows.filter((r) => r.status === 'new').length,
    update: rows.filter((r) => r.status === 'update').length,
    delete: rows.filter((r) => r.status === 'delete').length,
    error: rows.filter((r) => r.status === 'error').length,
  }

  const visible =
    filter === 'all' ? rows : rows.filter((row) => row.status === filter)
  const applicable = counts.new + counts.update + counts.delete
  const deleteReady =
    counts.delete === 0 || deleteConfirm.trim() === String(counts.delete)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryCard
          label="새로 등록"
          value={formatNumber(counts.new)}
          tone="success"
        />
        <SummaryCard
          label="기존 상품 갱신"
          value={formatNumber(counts.update)}
          tone="default"
        />
        <SummaryCard
          label="삭제"
          value={formatNumber(counts.delete)}
          tone={counts.delete > 0 ? 'danger' : 'default'}
        />
        <SummaryCard
          label="확인 필요"
          value={formatNumber(counts.error)}
          tone={counts.error > 0 ? 'danger' : 'default'}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(FILTER_LABEL) as Filter[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cn(
              'rounded-md border px-3 py-1.5 text-sm transition-colors',
              filter === key
                ? 'border-foreground/30 bg-accent'
                : 'border-border hover:bg-muted',
            )}
          >
            {FILTER_LABEL[key]} {formatNumber(counts[key])}
          </button>
        ))}

        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="size-4 accent-foreground"
            checked={emptyMeans === 'clear'}
            onChange={(event) =>
              onEmptyMeansChange(event.target.checked ? 'clear' : 'keep')
            }
          />
          빈 칸은 값 지우기
        </label>
      </div>

      {emptyMeans === 'clear' ? (
        <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
          파일에서 비워 둔 칸이 기존 값을 지웁니다. 품번·상품명·시즌·성별·상태는
          비울 수 없어 그대로 유지됩니다.
        </p>
      ) : null}

      <Card className="overflow-hidden">
        <div className="max-h-125 overflow-auto">
          <table className="w-full min-w-200 text-left text-sm">
            <thead className="sticky top-0 border-b border-border bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">행</th>
                <th className="px-4 py-3 font-medium">품번</th>
                <th className="px-4 py-3 font-medium">상태</th>
                <th className="px-4 py-3 font-medium">반영될 내용</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    해당하는 행이 없습니다.
                  </td>
                </tr>
              ) : (
                visible.map((row) => (
                  <tr
                    key={row.lineNo}
                    className="border-b border-border last:border-0 align-top"
                  >
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {row.lineNo}
                    </td>
                    <td className="px-4 py-3 font-medium tabular-nums">
                      {row.styleNo || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {row.status === 'new' ? (
                        <Badge variant="success">신규</Badge>
                      ) : row.status === 'update' ? (
                        <Badge variant="outline">업데이트</Badge>
                      ) : row.status === 'delete' ? (
                        <Badge variant="danger">삭제</Badge>
                      ) : (
                        <Badge variant="danger">오류</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.errors.length > 0 ? (
                        <ul className="space-y-0.5 text-danger">
                          {row.errors.map((error) => (
                            <li key={error}>{error}</li>
                          ))}
                        </ul>
                      ) : (
                        <div className="space-y-1">
                          <div className="text-muted-foreground">
                            {describeApplied(row)}
                          </div>
                          {row.warnings.map((warning) => (
                            <div key={warning} className="text-warning">
                              {warning}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {counts.delete > 0 ? (
        <div className="space-y-3 rounded-lg border border-danger/40 bg-danger/5 p-4">
          <div>
            <p className="text-sm font-medium text-danger">
              상품 {formatNumber(counts.delete)}건이 삭제됩니다
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {ROW_ACTION_HEADER} 열에 &quot;삭제&quot;라고 적힌 행입니다. 되돌릴
              수 있도록 삭제 직전에 대상 행이 백업 파일로 내려갑니다. 확인을 위해
              삭제 건수를 입력하세요.
            </p>
          </div>
          <Input
            className="max-w-40"
            value={deleteConfirm}
            onChange={(event) => setDeleteConfirm(event.target.value)}
            placeholder={String(counts.delete)}
            inputMode="numeric"
            aria-label="삭제 건수 확인"
          />
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="outline" onClick={onBack}>
          이전
        </Button>
        <div className="flex items-center gap-3">
          {counts.error > 0 ? (
            <span className="text-sm text-muted-foreground">
              오류 {formatNumber(counts.error)}건은 건너뜁니다
            </span>
          ) : null}
          <Button
            type="button"
            onClick={onApply}
            disabled={applicable === 0 || isApplying || !deleteReady}
          >
            {isApplying ? '반영 중...' : `${formatNumber(applicable)}건 반영`}
          </Button>
        </div>
      </div>
    </div>
  )
}

function describeApplied(row: PreparedRow) {
  if (row.status === 'delete') return '이 상품을 삭제합니다'

  const labels = Object.keys(row.applied)
    .map((key) =>
      key === 'seasonId' ? '시즌' : (FIELD_MAP.get(key)?.label ?? null),
    )
    .filter(Boolean)
  const customCount = Object.keys(row.customFields).length
  const clearCount = row.clearKeys.length + row.clearCustomFields.length

  const parts = [...labels]
  if (customCount > 0) parts.push(`추가 컬럼 ${customCount}개`)
  if (clearCount > 0) parts.push(`빈 칸으로 지움 ${clearCount}개`)

  if (parts.length === 0) return '변경할 값이 없습니다'
  return parts.join(', ')
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'default' | 'success' | 'danger'
}) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-1 text-xl font-semibold tabular-nums',
          tone === 'success' && 'text-success',
          tone === 'danger' && 'text-danger',
        )}
      >
        {value}
      </div>
    </Card>
  )
}
