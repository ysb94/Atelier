import { Fragment, useState } from 'react'
import { formatStyleRef } from '@/components/style-picker'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import {
  accessoryReviewExpectedLines,
  type AccessoryReviewRow,
} from '@/lib/invoice/accessory-review-table'
import type { AccessorySuggestHoldReason } from '@/lib/invoice/accessory-suggest'
import type { InvoiceItemNameRuleAction } from '@/lib/types'
import { formatNumber } from '@/lib/utils'
import {
  InvoiceOptionExtrasEditor,
  extrasFromRuleComponents,
  newOptionExtraDraft,
} from './InvoiceOptionExtrasEditor'
import {
  extrasOfReviewRow,
  useInvoiceAccessoryBulkAiApply,
} from './useInvoiceAccessoryBulkAiApply'

const HOLD_REASON_LABEL: Record<AccessorySuggestHoldReason, string> = {
  invalid_type: '종류 오류',
  incomplete: '필수값 없음',
  invalid_style: '상품 없음',
  conflict: '이미 있음',
  no_effect: '효과 없음',
  no_rule: '추천 없음',
  failed: '추천 실패',
  context_conflict: '문맥 충돌',
  unsafe_global: '전역 위험',
}

function ExpectedCell({
  row,
  onEdit,
}: {
  row: AccessoryReviewRow
  onEdit: () => void
}) {
  const lines = accessoryReviewExpectedLines(row.action, row.components)
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 break-words">{lines[0]}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-6 shrink-0 px-2 text-[11px]"
          onClick={onEdit}
        >
          수정
        </Button>
      </div>
      {lines.slice(1).map((line) => (
        <p key={line} className="break-words">
          {line}
        </p>
      ))}
      {row.revalidationError ? (
        <p className="text-[11px] text-danger">{row.revalidationError}</p>
      ) : null}
    </div>
  )
}

export function InvoiceAccessoryAiApplyBar({
  bulk,
}: {
  bulk: ReturnType<typeof useInvoiceAccessoryBulkAiApply>
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const holdCounts = new Map<AccessorySuggestHoldReason, number>()
  for (const row of bulk.holdRows) {
    holdCounts.set(row.reason, (holdCounts.get(row.reason) ?? 0) + 1)
  }

  const selectable = bulk.reviewRows.filter(
    (row) => !row.revalidationError && row.mainStyle && row.productLookupKey,
  )
  const selectedCount = selectable.filter((row) => bulk.selected.has(row.key)).length
  const allSelected =
    selectable.length > 0 && selectedCount === selectable.length

  function toggleAll(checked: boolean) {
    if (checked) {
      for (const row of selectable) {
        if (!bulk.selected.has(row.key)) bulk.toggle(row.key)
      }
      return
    }
    bulk.clearSelection()
  }

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">AI 부속품 추천</p>
          <p className="mt-1 text-xs text-muted-foreground">
            사전에 없는 조각 {formatNumber(bulk.unknownCount)}개의 조합을 먼저
            모읍니다. 표에서 예상 변환명을 확인하고 고른 행만 등록됩니다.
          </p>
        </div>
        {bulk.phase === 'collecting' ? (
          <Button type="button" size="sm" variant="ghost" onClick={bulk.cancel}>
            중단
          </Button>
        ) : bulk.phase === 'review' ? (
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              size="sm"
              disabled={bulk.selectedCount === 0 || bulk.applying}
              onClick={() => void bulk.applySelected()}
            >
              {bulk.applying
                ? '저장 중...'
                : `선택 ${formatNumber(bulk.selectedCount)}개 등록`}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={bulk.reset}>
              닫기
            </Button>
          </div>
        ) : bulk.phase === 'applied' ? (
          <Button type="button" size="sm" variant="ghost" onClick={bulk.reset}>
            닫기
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!bulk.routeReady || bulk.unknownCount === 0}
            onClick={() => void bulk.collect()}
          >
            추천 모으기
          </Button>
        )}
      </div>

      {bulk.routeLoading ? (
        <p className="mt-2 text-xs text-muted-foreground">
          AI 설정을 불러오는 중...
        </p>
      ) : !bulk.routeReady ? (
        <p className="mt-2 text-xs text-muted-foreground">
          설정 → AI 설정에서 부속품 사전 모델을 켜면 일괄 검토를 쓸 수 있습니다.
        </p>
      ) : null}

      {bulk.phase === 'collecting' ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {formatNumber(bulk.progress.done)} /{' '}
          {formatNumber(bulk.progress.total)} 추천을 모으는 중...
        </p>
      ) : null}

      {bulk.phase === 'applied' ? (
        <p className="mt-2 text-xs">
          {formatNumber(bulk.appliedCount)}건 등록
          {bulk.failedCount
            ? ` · 실패 ${formatNumber(bulk.failedCount)}건`
            : ''}
        </p>
      ) : null}

      {bulk.applyError ? (
        <p className="mt-2 text-xs text-danger">{bulk.applyError}</p>
      ) : null}

      {bulk.phase === 'review' ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="text-muted-foreground">
              추천 {formatNumber(bulk.reviewRows.length)}개 ·{' '}
              {formatNumber(bulk.recommendedCount)}개를 미리 골라뒀습니다.
            </span>
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={bulk.selectRecommended}
            >
              기준 통과만 선택
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:underline"
              onClick={bulk.clearSelection}
            >
              전체 해제
            </button>
          </div>

          {bulk.reviewRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              바로 등록할 후보가 없습니다. 아래 보류 목록을 확인하세요.
            </p>
          ) : (
            <div className="max-h-[32rem] overflow-auto rounded-md border border-border bg-card">
              <table className="w-full min-w-[56rem] text-left text-xs">
                <thead className="sticky top-0 bg-muted/80">
                  <tr>
                    <th className="w-10 px-2 py-1.5">
                      <input
                        type="checkbox"
                        aria-label="선택 가능한 조합 전체"
                        checked={allSelected}
                        disabled={selectable.length === 0}
                        onChange={(event) => toggleAll(event.target.checked)}
                      />
                    </th>
                    <th className="px-2 py-1.5 font-medium">조회 키</th>
                    <th className="px-2 py-1.5 font-medium">옵션명</th>
                    <th className="px-2 py-1.5 font-medium">예상 옵션 변환명</th>
                    <th className="px-2 py-1.5 font-medium">대상 행</th>
                  </tr>
                </thead>
                <tbody>
                  {bulk.reviewRows.map((row) => {
                    const disabled = Boolean(
                      row.revalidationError || !row.mainStyle || !row.productLookupKey,
                    )
                    const open = editingKey === row.key
                    return (
                      <Fragment key={row.key}>
                        <tr
                          className={`border-t border-border ${
                            row.action === 'delete'
                              ? 'bg-warning/20'
                              : disabled
                                ? 'bg-muted/20 text-muted-foreground'
                                : ''
                          }`}
                        >
                          <td className="px-2 py-1.5">
                            <input
                              type="checkbox"
                              aria-label={`${row.productLookupKey || '조회 키 없음'} 선택`}
                              checked={bulk.selected.has(row.key)}
                              disabled={disabled}
                              onChange={() => bulk.toggle(row.key)}
                            />
                          </td>
                          <td className="max-w-72 break-words px-2 py-1.5">
                            <div className="space-y-0.5">
                              <p>{row.productLookupKey || '(조회 키 없음)'}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {row.mainStyle
                                  ? formatStyleRef(row.mainStyle)
                                  : '본품 미확정'}
                              </p>
                            </div>
                          </td>
                          <td className="max-w-56 break-words px-2 py-1.5">
                            {row.itemName || '(옵션명 없음)'}
                          </td>
                          <td className="max-w-72 px-2 py-1.5">
                            <ExpectedCell
                              row={row}
                              onEdit={() =>
                                setEditingKey(open ? null : row.key)
                              }
                            />
                          </td>
                          <td className="px-2 py-1.5 tabular-nums">
                            {formatNumber(row.rowCount)}
                          </td>
                        </tr>
                        {open ? (
                          <tr
                            className={`border-t border-border ${
                              row.action === 'delete'
                                ? 'bg-warning/15'
                                : 'bg-muted/20'
                            }`}
                          >
                            <td colSpan={5} className="px-3 py-2">
                              <div className="max-w-xl space-y-2">
                                <Select
                                  value={row.action}
                                  onChange={(event) =>
                                    bulk.updateRow(row.key, {
                                      action: event.target
                                        .value as InvoiceItemNameRuleAction,
                                      extras:
                                        event.target.value === 'components' &&
                                        row.components.length === 0
                                          ? [newOptionExtraDraft()]
                                          : extrasOfReviewRow(row),
                                    })
                                  }
                                  className="h-8 w-48 text-xs"
                                >
                                  <option value="components">
                                    내품명을 구성품으로
                                  </option>
                                  <option value="delete">내품명만 비움</option>
                                </Select>
                                {row.action === 'components' ? (
                                  <InvoiceOptionExtrasEditor
                                    brandId={bulk.brandId}
                                    extras={
                                      extrasOfReviewRow(row).length > 0
                                        ? extrasOfReviewRow(row)
                                        : extrasFromRuleComponents([])
                                    }
                                    onChange={(extras) =>
                                      bulk.updateRow(row.key, { extras })
                                    }
                                    compact
                                  />
                                ) : (
                                  <p className="text-[11px] text-muted-foreground">
                                    색상·사이즈처럼 본품 속성만 있으면 내품명을
                                    비웁니다.
                                  </p>
                                )}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {holdCounts.size > 0 ? (
            <p className="text-xs text-muted-foreground">
              보류 {formatNumber(bulk.holdRows.length)}건
              {[...holdCounts.entries()].map(([reason, count]) => (
                <span key={reason}>
                  {' · '}
                  {HOLD_REASON_LABEL[reason]} {formatNumber(count)}
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
