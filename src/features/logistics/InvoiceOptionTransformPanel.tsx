import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import type {
  InvoiceOptionMatchStatus,
  InvoiceOptionTransformation,
  UnresolvedInvoiceCombo,
} from '@/lib/invoice/option-transform'
import { formatNumber } from '@/lib/utils'
import { InvoiceOptionMapForm } from './InvoiceOptionMapForm'

const STATUS_META: Record<
  InvoiceOptionMatchStatus,
  { label: string; variant: 'success' | 'default' | 'warning' | 'danger' }
> = {
  mapped: { label: '자동 완료', variant: 'success' },
  code_fallback: { label: '코드 보조', variant: 'default' },
  exception: { label: '예외 유지', variant: 'default' },
  unresolved: { label: '검토 필요', variant: 'danger' },
  conflict: { label: '충돌', variant: 'warning' },
}

export function InvoiceOptionTransformPanel({
  brandId,
  transformation,
}: {
  brandId: string
  transformation: InvoiceOptionTransformation
}) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | InvoiceOptionMatchStatus>('all')
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
        row.source.mallName,
        row.source.ownProductCode,
        row.transformedName,
        row.transformedItemName,
        row.main?.styleNo,
        row.main?.name,
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
        <Badge variant="outline">
          코드 보조 {formatNumber(transformation.codeFallbackRowCount)}
        </Badge>
        <Badge variant="muted">
          예외 {formatNumber(transformation.exceptionRowCount)}
        </Badge>
        <Badge variant="danger">
          검토 필요 {formatNumber(transformation.unresolvedRowCount)}
        </Badge>
        <Badge variant="warning">
          충돌 {formatNumber(transformation.conflictRowCount)}
        </Badge>
      </div>

      {reviewCount > 0 ? (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">
              검토 필요 조합 {formatNumber(combos.length)}개
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              자주 나온 순입니다. 본품·구성을 고르고 저장하면 현재 파일 전체에
              바로 다시 적용됩니다.
            </p>
          </div>
          <div className="space-y-2">
            {combos.map((combo) => (
              <ComboReviewCard
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
          이 파일의 품목·옵션 조합은 모두 변환 기준 또는 보조 코드로
          연결됐습니다.
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
            setStatus(event.target.value as 'all' | InvoiceOptionMatchStatus)
          }
          className="w-36"
        >
          <option value="all">상태 전체</option>
          <option value="mapped">자동 완료</option>
          <option value="code_fallback">코드 보조</option>
          <option value="exception">예외 유지</option>
          <option value="unresolved">검토 필요</option>
          <option value="conflict">충돌</option>
        </Select>
      </div>

      <div className="max-h-[28rem] overflow-auto rounded-lg border border-border">
        <table className="w-full min-w-[960px] text-left text-xs">
          <thead className="sticky top-0 bg-muted/80">
            <tr>
              <th className="px-3 py-2 font-medium">행</th>
              <th className="px-3 py-2 font-medium">원본 품목명</th>
              <th className="px-3 py-2 font-medium">원본 내품명</th>
              <th className="px-3 py-2 font-medium">본품</th>
              <th className="px-3 py-2 font-medium">내품명(구성)</th>
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
                    {row.source.productName}
                  </td>
                  <td className="max-w-40 truncate px-3 py-2">
                    {row.source.itemName || '-'}
                  </td>
                  <td className="max-w-48 truncate px-3 py-2">
                    {row.main
                      ? `${row.main.styleNo} · ${row.transformedName}`
                      : row.transformedName}
                  </td>
                  <td className="max-w-64 truncate px-3 py-2 text-muted-foreground">
                    {row.transformedItemName}
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
      {rows.length > 300 ? (
        <p className="text-xs text-muted-foreground">
          표는 앞 300행입니다. 저장한 기준은 파일 전체에 적용됩니다.
        </p>
      ) : null}
    </div>
  )
}

function ComboReviewCard({
  brandId,
  combo,
  open,
  onToggle,
}: {
  brandId: string
  combo: UnresolvedInvoiceCombo
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
          <p className="truncate text-sm font-medium">{combo.productName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {combo.itemName || '내품명 없음'}
            {combo.mallName ? ` · ${combo.mallName}` : ''}
            {combo.ownProductCode ? ` · ${combo.ownProductCode}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {combo.codeHintName ? (
            <span className="text-[11px] text-muted-foreground">
              코드 힌트 {combo.codeHintName}
            </span>
          ) : null}
          <Badge variant={combo.status === 'conflict' ? 'warning' : 'danger'}>
            {combo.status === 'conflict' ? '충돌' : '미해결'}{' '}
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
            submitLabel="기준으로 저장 후 재적용"
          />
        </div>
      ) : null}
    </div>
  )
}
