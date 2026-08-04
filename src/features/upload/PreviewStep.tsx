import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FIELD_MAP } from '@/lib/import/fields'
import type { PreparedRow } from '@/lib/import/transform'
import { cn, formatNumber } from '@/lib/utils'

type Filter = 'all' | 'new' | 'update' | 'error'

type PreviewStepProps = {
  rows: PreparedRow[]
  isApplying: boolean
  onBack: () => void
  onApply: () => void
}

const FILTER_LABEL: Record<Filter, string> = {
  all: '전체',
  new: '신규',
  update: '업데이트',
  error: '오류',
}

export function PreviewStep({
  rows,
  isApplying,
  onBack,
  onApply,
}: PreviewStepProps) {
  const [filter, setFilter] = useState<Filter>('all')

  const counts = {
    all: rows.length,
    new: rows.filter((r) => r.status === 'new').length,
    update: rows.filter((r) => r.status === 'update').length,
    error: rows.filter((r) => r.status === 'error').length,
  }

  const visible =
    filter === 'all' ? rows : rows.filter((row) => row.status === filter)
  const applicable = counts.new + counts.update

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
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
          label="확인 필요"
          value={formatNumber(counts.error)}
          tone={counts.error > 0 ? 'danger' : 'default'}
        />
      </div>

      <div className="flex flex-wrap gap-2">
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
      </div>

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
            disabled={applicable === 0 || isApplying}
          >
            {isApplying
              ? '등록 중...'
              : `${formatNumber(applicable)}건 등록`}
          </Button>
        </div>
      </div>
    </div>
  )
}

function describeApplied(row: PreparedRow) {
  const labels = Object.keys(row.applied)
    .map((key) => (key === 'seasonId' ? '시즌' : FIELD_MAP.get(key)?.label))
    .filter(Boolean)
  const customCount = Object.keys(row.customFields).length

  if (labels.length === 0 && customCount === 0) return '변경할 값이 없습니다'

  const parts = [...labels]
  if (customCount > 0) parts.push(`추가 컬럼 ${customCount}개`)
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
