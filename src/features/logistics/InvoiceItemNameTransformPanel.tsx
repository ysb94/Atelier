import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import type {
  InvoiceItemNameMatchStatus,
  InvoiceItemNameTransformation,
  UnresolvedItemNameCombo,
} from '@/lib/invoice/item-name-transform'
import { formatOptionItemName } from '@/lib/invoice/option-transform'
import { formatNumber } from '@/lib/utils'
import { InvoiceOptionMapForm } from './InvoiceOptionMapForm'

const STATUS_META: Record<
  InvoiceItemNameMatchStatus,
  { label: string; variant: 'success' | 'default' | 'warning' | 'danger' }
> = {
  mapped: { label: '자동 완료', variant: 'success' },
  consumed: { label: '본품 식별 후 비움', variant: 'success' },
  passthrough: { label: '원문 유지/검토 필요', variant: 'danger' },
  unresolved: { label: '검토 필요', variant: 'danger' },
  conflict: { label: '충돌', variant: 'warning' },
}

export function InvoiceItemNameTransformPanel({
  brandId,
  transformation,
}: {
  brandId: string
  transformation: InvoiceItemNameTransformation
}) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | InvoiceItemNameMatchStatus>(
    'all',
  )
  const [openKey, setOpenKey] = useState<string | null>(
    transformation.unresolvedCombos[0]?.key ?? null,
  )

  const combos = transformation.unresolvedCombos
  const reviewCount =
    transformation.unresolvedRowCount + transformation.conflictRowCount

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('ko-KR')
    return transformation.rows.filter((row) => {
      if (status !== 'all' && row.status !== status) return false
      if (!q) return true
      return [
        row.source.productName,
        row.source.itemName,
        row.transformedItemName,
        row.productStyle?.name,
        row.productStyle?.styleNo,
      ]
        .join(' ')
        .toLocaleLowerCase('ko-KR')
        .includes(q)
    })
  }, [query, status, transformation.rows])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <Badge variant="success">
          자동 완료 {formatNumber(transformation.mappedRowCount)}
        </Badge>
        <Badge variant="success">
          본품 식별 후 비움 {formatNumber(transformation.consumedRowCount)}
        </Badge>
        <Badge variant="danger">
          원문 유지/검토 {formatNumber(transformation.passthroughRowCount)}
        </Badge>
        <Badge variant="warning">
          충돌 {formatNumber(transformation.conflictRowCount)}
        </Badge>
      </div>

      {reviewCount > 0 ? (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">
              내품명 확인 {formatNumber(combos.length)}개
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              승인된 규칙이 없으면 원문을 유지합니다. 단, 내품명 옵션값 단독
              조회 키가 품목명 원장과 정확히 맞으면 본품 식별에 사용된 내품명은
              빈 값으로 확정합니다.
            </p>
          </div>
          <div className="space-y-2">
            {combos.map((combo) => (
              <ItemReviewCard
                key={combo.key}
                brandId={brandId}
                combo={combo}
                open={openKey === combo.key}
                onToggle={() =>
                  setOpenKey((current) =>
                    current === combo.key ? null : combo.key,
                  )
                }
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-success/30 bg-success/10 p-4 text-sm">
          이 파일의 내품명 조합은 모두 기준으로 연결됐거나 원문 유지로
          확정됐습니다.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="행 검색"
          className="max-w-xs"
        />
        <Select
          value={status}
          onChange={(event) =>
            setStatus(event.target.value as 'all' | InvoiceItemNameMatchStatus)
          }
          className="w-44"
        >
          <option value="all">상태 전체</option>
          <option value="mapped">자동 완료</option>
          <option value="consumed">본품 식별 후 비움</option>
          <option value="passthrough">원문 유지/검토 필요</option>
          <option value="conflict">충돌</option>
        </Select>
      </div>

      <div className="max-h-[28rem] overflow-auto rounded-lg border border-border">
        <table className="w-full min-w-[960px] text-left text-xs">
          <thead className="sticky top-0 bg-muted/80">
            <tr>
              <th className="px-3 py-2 font-medium">행</th>
              <th className="px-3 py-2 font-medium">원본 내품명</th>
              <th className="px-3 py-2 font-medium">변환 내품명</th>
              <th className="px-3 py-2 font-medium">구성</th>
              <th className="px-3 py-2 font-medium">상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 300).map((row) => {
              const meta = STATUS_META[row.status]
              return (
                <tr
                  key={row.source.rowNumber}
                  className="border-t border-border"
                >
                  <td className="px-3 py-2 tabular-nums">
                    {row.source.rowNumber}
                  </td>
                  <td className="max-w-48 truncate px-3 py-2">
                    {row.source.itemName || '(빈 값)'}
                  </td>
                  <td className="max-w-48 truncate px-3 py-2">
                    {row.transformedItemName || '(빈 값)'}
                  </td>
                  <td className="max-w-56 truncate px-3 py-2 text-muted-foreground">
                    {row.extras.length > 0
                      ? formatOptionItemName(row.extras)
                      : '-'}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ItemReviewCard({
  brandId,
  combo,
  open,
  onToggle,
}: {
  brandId: string
  combo: UnresolvedItemNameCombo
  open: boolean
  onToggle: () => void
}) {
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {combo.itemName || '내품명 없음'}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {combo.productName}
            {combo.productStyle
              ? ` · 본품 ${combo.productStyle.styleNo}`
              : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge
            variant={combo.status === 'conflict' ? 'warning' : 'danger'}
          >
            {combo.status === 'conflict' ? '충돌' : '원문 유지'}{' '}
            {formatNumber(combo.rowCount)}행
          </Badge>
          <Button type="button" size="sm" variant="ghost">
            {open ? '접기' : '지정'}
          </Button>
        </div>
      </button>
      {open ? (
        <div className="border-t border-border p-3">
          <InvoiceOptionMapForm
            brandId={brandId}
            initialProductName={combo.productName}
            initialItemName={combo.itemName}
            initialMallName={combo.mallName}
            initialOwnProductCode={combo.ownProductCode}
            lockSource
            submitLabel="내품명 기준으로 저장 후 재적용"
          />
        </div>
      ) : null}
    </div>
  )
}
