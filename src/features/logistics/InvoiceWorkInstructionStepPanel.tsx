import { useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  planWorkInstructions,
  applyWorkInstructionLabel,
} from '@/lib/invoice/work-instruction-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type { InvoiceWorkInstruction } from '@/lib/types'
import { formatNumber } from '@/lib/utils'

function formatMoment(value: string): string {
  return `${value.slice(0, 10).replaceAll('-', '.')} ${value.slice(11, 16)}`
}

export function InvoiceWorkInstructionStepPanel({
  rows,
  instructions,
  loading,
  error,
}: {
  rows: SabangnetOrderRow[]
  instructions: InvoiceWorkInstruction[]
  loading: boolean
  error: string | null
}) {
  const plan = useMemo(
    () => planWorkInstructions(rows, instructions),
    [rows, instructions],
  )

  const previewRows = useMemo(() => {
    return rows
      .filter((row) => plan.matchByRowNumber.has(row.rowNumber))
      .map((row) => {
        const match = plan.matchByRowNumber.get(row.rowNumber)!
        return {
          rowNumber: row.rowNumber,
          mallName: row.mallName,
          productName: row.productName,
          labelText: match.labelText,
          after: applyWorkInstructionLabel(match.labelText, row.productName),
          instructionTitle: match.instructionTitle,
        }
      })
  }, [rows, plan])

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">
        작업 지시를 불러오는 중입니다.
      </p>
    )
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>{error}</span>
      </div>
    )
  }

  const activeCount = instructions.filter((item) => item.isActive).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <span className="inline-flex items-baseline gap-1 rounded-md bg-success/10 px-1.5 py-0.5 text-success">
          <span className="text-xs">적용 행</span>
          <span className="font-semibold tabular-nums">
            {formatNumber(plan.matchedRowCount)}
          </span>
        </span>
        <span className="inline-flex items-baseline gap-1 rounded-md px-1.5 py-0.5">
          <span className="text-xs text-muted-foreground">활성 지시</span>
          <span className="font-semibold tabular-nums">
            {formatNumber(activeCount)}
          </span>
        </span>
        <span className="inline-flex items-baseline gap-1 rounded-md px-1.5 py-0.5">
          <span className="text-xs text-muted-foreground">못 찾은 대상</span>
          <span className="font-semibold tabular-nums">
            {formatNumber(plan.unusedProductNames.length)}
          </span>
        </span>
        {plan.outOfPeriodRowCount > 0 ? (
          <span className="inline-flex items-baseline gap-1 rounded-md bg-warning/10 px-1.5 py-0.5 text-warning">
            <span className="text-xs">기간 밖</span>
            <span className="font-semibold tabular-nums">
              {formatNumber(plan.outOfPeriodRowCount)}
            </span>
          </span>
        ) : null}
        {plan.materialTotals.length > 0 ? (
          <span className="inline-flex items-baseline gap-1 rounded-md bg-success/10 px-1.5 py-0.5 text-success">
            <span className="text-xs">포장재</span>
            <span className="font-semibold tabular-nums">
              {formatNumber(
                plan.materialTotals.reduce((sum, item) => sum + item.count, 0),
              )}
            </span>
          </span>
        ) : null}
      </div>

      {plan.fileFirstMoment && plan.fileLastMoment ? (
        <p className="text-xs text-muted-foreground">
          이 파일의 주문일시는 {formatMoment(plan.fileFirstMoment)} ~{' '}
          {formatMoment(plan.fileLastMoment)}입니다. 적용 기간이 있는 지시는
          이 범위와 겹치는 행에만 붙습니다.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          원본 품목명이 작업 지시 대상과 같으면, 자체품번 변환이 끝난 최종
          품목명 앞에 표시 문구를 붙입니다. 사은품 행에는 적용하지 않습니다.
        </p>
      )}

      {plan.periodMisses.length > 0 ? (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="size-4 text-warning" />
            <p className="text-sm font-medium">
              파일 주문일시와 적용 기간이 겹치지 않습니다
            </p>
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {plan.periodMisses.map((item) => (
              <li key={item.instructionId}>
                {item.instructionTitle} · {formatMoment(item.startsAt)} ~{' '}
                {formatMoment(item.endsAt)}
                {item.nameMatchedRowCount > 0
                  ? ` · 품목명은 ${formatNumber(item.nameMatchedRowCount)}행에서 같음`
                  : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.outOfPeriodRowCount > 0 && plan.periodMisses.length === 0 ? (
        <p className="text-xs text-warning">
          품목명은 같지만 지시 기간을 벗어난 행이{' '}
          {formatNumber(plan.outOfPeriodRowCount)}건 있습니다.
        </p>
      ) : null}

      {plan.undatedRowCount > 0 ? (
        <p className="text-xs text-warning">
          주문일시를 읽을 수 없어 기간 있는 지시를 판단하지 못한 행이{' '}
          {formatNumber(plan.undatedRowCount)}건 있습니다.
        </p>
      ) : null}

      {plan.conflicts.length > 0 ? (
        <div className="rounded-lg border border-danger/40 bg-danger/5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="size-4 text-danger" />
            <p className="text-sm font-medium text-danger">
              같은 상품에 작업 지시가 겹칩니다 ({plan.conflicts.length}건)
            </p>
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {plan.conflicts.map((conflict) => (
              <li key={conflict.productName}>
                {conflict.productName} · {formatNumber(conflict.rowCount)}행 ·{' '}
                {conflict.candidates
                  .map((candidate) => candidate.instructionTitle)
                  .join(' / ')}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.materialTotals.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <p className="bg-muted/40 px-3 py-2 text-xs font-medium">
            이번 파일에서 나갈 포장재
          </p>
          <table className="w-full min-w-140 text-left text-xs">
            <thead className="bg-muted/60">
              <tr>
                <th className="px-3 py-2.5 font-medium">M번호</th>
                <th className="px-3 py-2.5 font-medium">제품명</th>
                <th className="px-3 py-2.5 font-medium">개수</th>
                <th className="px-3 py-2.5 font-medium">지시</th>
              </tr>
            </thead>
            <tbody>
              {plan.materialTotals.map((item) => (
                <tr key={item.styleId} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{item.styleNo}</td>
                  <td className="px-3 py-2">{item.name}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatNumber(item.count)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {item.instructionTitles.join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            실재고 차감은 아직 연결하지 않았습니다. 이 수량이 이후 재고 예약의
            입력이 됩니다.
          </p>
        </div>
      ) : null}

      {plan.unusedProductNames.length > 0 ? (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="size-4 text-warning" />
            <p className="text-sm font-medium">이 파일에서 못 찾은 대상</p>
            <Badge variant="warning">
              {formatNumber(plan.unusedProductNames.length)}
            </Badge>
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {plan.unusedProductNames.slice(0, 12).map((item) => (
              <li key={`${item.instructionId}-${item.productName}`}>
                {item.instructionTitle} · {item.productName}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="bg-muted/60">
            <tr>
              <th className="px-3 py-2.5 font-medium">행</th>
              <th className="px-3 py-2.5 font-medium">쇼핑몰명</th>
              <th className="px-3 py-2.5 font-medium">원본 품목명</th>
              <th className="px-3 py-2.5 font-medium">표시 후</th>
              <th className="px-3 py-2.5 font-medium">지시</th>
            </tr>
          </thead>
          <tbody>
            {previewRows.length === 0 ? (
              <tr className="border-t border-border">
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-muted-foreground"
                >
                  {plan.periodMisses.length > 0
                    ? '품목명이 같아도 주문일시가 적용 기간 밖이면 붙이지 않습니다.'
                    : '이 파일에 적용할 작업 지시가 없습니다.'}
                </td>
              </tr>
            ) : (
              previewRows.slice(0, 200).map((row) => (
                <tr key={row.rowNumber} className="border-t border-border">
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {row.rowNumber}
                  </td>
                  <td className="px-3 py-2">{row.mallName || '-'}</td>
                  <td className="max-w-64 truncate px-3 py-2">
                    {row.productName}
                  </td>
                  <td className="max-w-72 truncate px-3 py-2 font-medium">
                    {row.after}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.instructionTitle}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {previewRows.length > 200 ? (
        <p className="text-xs text-muted-foreground">
          미리보기는 앞의 200행만 표시합니다. 변환과 다운로드에는 전체가
          들어갑니다.
        </p>
      ) : null}
    </div>
  )
}
