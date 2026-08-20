import { Fragment, useMemo, useState } from 'react'
import { StylePicker } from '@/components/style-picker'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import {
  itemNameAiExpectedLines,
  itemNameAiReviewKind,
  type ItemNameAiAction,
  type ItemNameAiReviewKind,
} from '@/lib/invoice/item-name-ai-review'
import { productCompositionSearchText } from '@/lib/invoice/product-composition'
import type { StyleRef } from '@/lib/types'
import { formatNumber } from '@/lib/utils'
import { ProductCompositionLines } from './ProductCompositionLines'
import {
  InvoiceOptionExtrasEditor,
  newOptionExtraDraft,
  type OptionExtraDraft,
} from './InvoiceOptionExtrasEditor'
import {
  extrasOfItemNameAiRow,
  useInvoiceItemNameBulkAiApply,
} from './useInvoiceItemNameBulkAiApply'

type ReviewFilter = 'all' | ItemNameAiReviewKind

type EditDraft = {
  key: string
  action: ItemNameAiAction
  extras: OptionExtraDraft[]
}

const REVIEW_FILTERS: Array<{
  value: ReviewFilter
  label: string
}> = [
  { value: 'all', label: '전체' },
  { value: 'delete', label: '내품명 비움' },
  { value: 'single', label: '옵션 상품 1개' },
  { value: 'bundle', label: '구성 2개 이상' },
  { value: 'hold', label: '결정 필요' },
]

export function InvoiceItemNameAiApplyBar({
  bulk,
}: {
  bulk: ReturnType<typeof useInvoiceItemNameBulkAiApply>
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ReviewFilter>('all')
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [bulkAppendMode, setBulkAppendMode] = useState(false)
  const [appendTargets, setAppendTargets] = useState<Set<string>>(new Set())
  const [appendStyle, setAppendStyle] = useState<StyleRef | null>(null)
  const [appendQty, setAppendQty] = useState(1)
  const [appendError, setAppendError] = useState<string | null>(null)

  function closeEdit() {
    setEditDraft(null)
    setEditError(null)
  }

  function openEdit(rowKey: string, action: ItemNameAiAction, extras: OptionExtraDraft[]) {
    setEditError(null)
    setEditDraft({
      key: rowKey,
      action,
      extras: extras.length > 0 ? extras : [newOptionExtraDraft()],
    })
  }

  function saveEdit() {
    if (!editDraft) return
    if (editDraft.action === 'components') {
      const ready = editDraft.extras.filter((item) => item.style)
      if (ready.length === 0) {
        setEditError('구성품 M번호를 하나 이상 고르세요.')
        return
      }
      bulk.updateRow(editDraft.key, {
        action: 'components',
        extras: ready,
      })
    } else {
      bulk.updateRow(editDraft.key, {
        action: editDraft.action,
        extras: [],
      })
    }
    closeEdit()
  }
  const kindCounts = useMemo(() => {
    const counts: Record<ItemNameAiReviewKind, number> = {
      delete: 0,
      single: 0,
      bundle: 0,
      hold: 0,
    }
    for (const row of bulk.reviewRows) counts[itemNameAiReviewKind(row)] += 1
    return counts
  }, [bulk.reviewRows])
  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ko-KR')
    return bulk.reviewRows
      .filter((row) => {
        if (editDraft?.key === row.key) {
          if (!normalized) return true
        } else if (filter !== 'all' && itemNameAiReviewKind(row) !== filter) {
          return false
        }
        if (!normalized) return true
        const shown = bulk.draftByKey.get(row.key) ?? row
        return [
          row.itemName,
          row.productLookupKey,
          row.mainStyle?.styleNo ?? '',
          row.mainStyle?.name ?? '',
          productCompositionSearchText(row.productComponents),
          ...itemNameAiExpectedLines(shown),
        ]
          .join(' ')
          .toLocaleLowerCase('ko-KR')
          .includes(normalized)
      })
      .sort((left, right) => {
        const byLookup = left.productLookupKey.localeCompare(
          right.productLookupKey,
          'ko-KR',
        )
        if (byLookup !== 0) return byLookup
        return left.itemName.localeCompare(right.itemName, 'ko-KR')
      })
  }, [bulk.draftByKey, bulk.reviewRows, editDraft?.key, filter, query])
  const selectableRows = visibleRows.filter(
    (row) => row.action !== 'hold' && !row.validationError,
  )
  const selectedVisibleCount = selectableRows.filter((row) =>
    bulk.selected.has(row.key),
  ).length
  const allVisibleSelected =
    selectableRows.length > 0 &&
    selectedVisibleCount === selectableRows.length

  const columnCount = bulkAppendMode ? 6 : 5
  const appendTargetVisibleCount = visibleRows.filter((row) =>
    appendTargets.has(row.key),
  ).length
  const allVisibleAppendTargets =
    visibleRows.length > 0 && appendTargetVisibleCount === visibleRows.length

  function toggleVisible(checked: boolean) {
    for (const row of selectableRows) {
      const selected = bulk.selected.has(row.key)
      if (checked !== selected) bulk.toggle(row.key)
    }
  }

  function toggleAppendTarget(key: string) {
    setAppendTargets((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleVisibleAppendTargets(checked: boolean) {
    setAppendTargets((current) => {
      const next = new Set(current)
      for (const row of visibleRows) {
        if (checked) next.add(row.key)
        else next.delete(row.key)
      }
      return next
    })
  }

  function appendToTargets() {
    if (!appendStyle) {
      setAppendError('구성품 M번호를 고르세요.')
      return
    }
    if (appendTargets.size === 0) {
      setAppendError('추가할 행을 고르세요.')
      return
    }
    setAppendError(null)
    bulk.appendComponentToRows(appendTargets, {
      style: appendStyle,
      quantity: appendQty,
    })
    setAppendTargets(new Set())
  }

  function closeBulkAppendMode() {
    if (
      bulk.hasDraftChanges &&
      !window.confirm('저장하지 않은 일괄 변경을 버릴까요?')
    ) {
      return
    }
    bulk.discardDrafts()
    setAppendTargets(new Set())
    setAppendError(null)
    setBulkAppendMode(false)
  }

  function openBulkAppendMode() {
    closeEdit()
    setAppendError(null)
    setBulkAppendMode(true)
  }

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">AI 내품명 추천</p>
          <p className="mt-1 text-xs text-muted-foreground">
            미설정 옵션 {formatNumber(bulk.groupCount)}개를 실제 조회 키 조합별로
            추천합니다. 예상 변환명을 고치고 선택한 행만 등록됩니다.
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
              disabled={
                bulk.selectedCount === 0 ||
                bulk.applying ||
                bulk.hasDraftChanges
              }
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
            disabled={!bulk.routeReady || bulk.contextCount === 0}
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
          설정 → AI 설정에서 내품명 옵션 추천 모델을 켜면 일괄 검토를 쓸 수
          있습니다.
        </p>
      ) : null}

      {bulk.phase === 'collecting' ? (
        <p className="mt-2 text-xs text-muted-foreground">
          조회 키 조합 {formatNumber(bulk.progress.done)} /{' '}
          {formatNumber(bulk.progress.total)}개 추천을 모으는 중... 먼저 온
          결과부터 아래에서 검수할 수 있습니다.
        </p>
      ) : null}

      {bulk.phase === 'applied' ? (
        <p className="mt-2 text-xs">
          {formatNumber(bulk.appliedCount)}개 조합 등록
          {bulk.failedCount
            ? ` · 실패 ${formatNumber(bulk.failedCount)}개`
            : ''}
        </p>
      ) : null}

      {bulk.applyError ? (
        <p className="mt-2 text-xs text-danger">{bulk.applyError}</p>
      ) : null}

      {bulk.phase === 'review' ||
      (bulk.phase === 'collecting' && bulk.reviewRows.length > 0) ? (
        <div className="mt-3 space-y-2">
          <div
            className="flex flex-wrap gap-1"
            role="tablist"
            aria-label="예상 변환 종류"
          >
            {REVIEW_FILTERS.map((item) => {
              const count =
                item.value === 'all'
                  ? bulk.reviewRows.length
                  : kindCounts[item.value]
              const active = filter === item.value
              return (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(item.value)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                    active
                      ? 'border-border bg-card text-foreground'
                      : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  }`}
                >
                  {item.label} {formatNumber(count)}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="옵션명·조회 키·M번호 검색"
              aria-label="AI 내품명 추천 검색"
              className="h-8 max-w-xs text-xs"
            />
            <span className="text-xs text-muted-foreground">
              추천 {formatNumber(bulk.recommendedCount)}개 · 결정 필요{' '}
              {formatNumber(bulk.pendingDecisionCount)}개
            </span>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={bulk.selectRecommended}
            >
              추천만 선택
            </button>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:underline"
              onClick={bulk.clearSelection}
            >
              전체 해제
            </button>
            <button
              type="button"
              className={`text-xs hover:underline ${
                bulkAppendMode ? 'text-foreground' : 'text-primary'
              }`}
              aria-pressed={bulkAppendMode}
              onClick={() => {
                if (bulkAppendMode) closeBulkAppendMode()
                else openBulkAppendMode()
              }}
            >
              {bulkAppendMode ? '일괄 넣기 닫기' : '구성품 일괄 넣기'}
            </button>
          </div>

          {bulkAppendMode ? (
            <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-card px-3 py-2">
              <div className="min-w-[14rem] flex-1">
                <p className="mb-1 text-[11px] text-muted-foreground">
                  넣을 구성품
                </p>
                <StylePicker
                  brandId={bulk.brandId}
                  value={appendStyle}
                  onChange={(next) => {
                    setAppendStyle(next)
                    setAppendError(null)
                  }}
                  placeholder="구성품 M번호 검색"
                />
              </div>
              <label className="space-y-1">
                <span className="block text-[11px] text-muted-foreground">
                  수량
                </span>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={appendQty}
                  onChange={(event) =>
                    setAppendQty(
                      Math.max(1, Math.floor(Number(event.target.value) || 1)),
                    )
                  }
                  aria-label="구성 수량"
                  className="h-8 w-16 text-xs"
                />
              </label>
              <Button
                type="button"
                size="sm"
                disabled={appendTargets.size === 0}
                onClick={appendToTargets}
              >
                선택 {formatNumber(appendTargets.size)}개 행에 추가
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={appendTargets.size === 0}
                onClick={() => setAppendTargets(new Set())}
              >
                대상 해제
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!bulk.lastAppend || bulk.lastAppend.previous.length === 0}
                onClick={bulk.undoLastAppend}
              >
                실행 취소
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!bulk.hasDraftChanges}
                onClick={bulk.commitDrafts}
              >
                변경 저장
              </Button>
              {bulk.lastAppend ? (
                <p className="text-xs text-muted-foreground">
                  추가 {formatNumber(bulk.lastAppend.addedKeys.length)}개 · 중복
                  건너뜀 {formatNumber(bulk.lastAppend.skippedKeys.length)}개
                </p>
              ) : null}
              {appendError ? (
                <p className="w-full text-[11px] text-danger">{appendError}</p>
              ) : (
                <p className="w-full text-[11px] text-muted-foreground">
                  넣기는 초안에만 쌓입니다. 변경 저장은 검수표 반영이고 DB
                  등록은 아닙니다.
                </p>
              )}
            </div>
          ) : null}

          <div className="max-h-[32rem] overflow-auto rounded-md border border-border bg-card">
            <table className="w-full min-w-[56rem] text-left text-xs">
              <thead className="sticky top-0 z-10 bg-muted/90">
                <tr>
                  <th className="w-10 px-2 py-1.5">
                    <input
                      type="checkbox"
                      aria-label="보이는 추천 전체 선택"
                      checked={allVisibleSelected}
                      disabled={selectableRows.length === 0}
                      onChange={(event) => toggleVisible(event.target.checked)}
                    />
                  </th>
                  {bulkAppendMode ? (
                    <th className="min-w-24 px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          aria-label="보이는 행 추가 대상 전체 선택"
                          checked={allVisibleAppendTargets}
                          disabled={visibleRows.length === 0}
                          onChange={(event) =>
                            toggleVisibleAppendTargets(event.target.checked)
                          }
                        />
                        <span className="font-medium">추가 대상</span>
                      </div>
                    </th>
                  ) : null}
                  <th className="px-2 py-1.5 font-medium">조회 키</th>
                  <th className="px-2 py-1.5 font-medium">옵션명</th>
                  <th className="px-2 py-1.5 font-medium">
                    예상 옵션 변환명
                  </th>
                  <th className="px-2 py-1.5 font-medium">대상 행</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columnCount}
                      className="px-2 py-6 text-center text-muted-foreground"
                    >
                      이 종류에 해당하는 추천이 없습니다.
                    </td>
                  </tr>
                ) : null}
                {visibleRows.map((row, index) => {
                  const draft = editDraft?.key === row.key ? editDraft : null
                  const open = Boolean(draft)
                  const shown = bulk.draftByKey.get(row.key) ?? row
                  const disabled = Boolean(
                    row.action === 'hold' || row.validationError,
                  )
                  const extras =
                    draft?.extras ??
                    (extrasOfItemNameAiRow(shown).length > 0
                      ? extrasOfItemNameAiRow(shown)
                      : [newOptionExtraDraft()])
                  const expectedLines = itemNameAiExpectedLines(shown)
                  const stripe =
                    index % 2 === 1 ? 'bg-muted/40' : 'bg-card'
                  return (
                    <Fragment key={row.key}>
                      <tr className={`border-t border-border ${stripe}`}>
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            aria-label={`${row.productLookupKey || row.itemName} 선택`}
                            checked={bulk.selected.has(row.key)}
                            disabled={disabled}
                            onChange={() => bulk.toggle(row.key)}
                          />
                        </td>
                        {bulkAppendMode ? (
                          <td className="px-2 py-1.5">
                            <input
                              type="checkbox"
                              aria-label={`${row.productLookupKey || row.itemName} 추가 대상`}
                              checked={appendTargets.has(row.key)}
                              onChange={() => toggleAppendTarget(row.key)}
                            />
                          </td>
                        ) : null}
                        <td className="max-w-72 break-words px-2 py-1.5">
                          <div className="space-y-0.5">
                            <p>{row.productLookupKey || '(조회 키 없음)'}</p>
                            <ProductCompositionLines
                              items={row.productComponents}
                              className="space-y-0.5 text-[11px] text-muted-foreground"
                            />
                          </div>
                        </td>
                        <td className="max-w-56 break-words px-2 py-1.5">
                          {row.itemName}
                        </td>
                        <td className="max-w-72 px-2 py-1.5">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="min-w-0 break-words">
                                {expectedLines[0]}
                              </p>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-6 shrink-0 px-2 text-[11px]"
                                disabled={bulk.hasDraftChanges}
                                onClick={() => {
                                  if (open) {
                                    closeEdit()
                                    return
                                  }
                                  openEdit(
                                    row.key,
                                    row.action,
                                    extrasOfItemNameAiRow(row),
                                  )
                                }}
                              >
                                {open ? '닫기' : '수정'}
                              </Button>
                            </div>
                            {expectedLines.slice(1).map((line) => (
                                <p key={line} className="break-words">
                                  {line}
                                </p>
                              ))}
                            {shown.validationError ? (
                              <p className="text-[11px] text-danger">
                                {shown.validationError}
                              </p>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">
                          {formatNumber(row.rowCount)}
                        </td>
                      </tr>
                      {open ? (
                        <tr className={`border-t border-border ${stripe}`}>
                          <td colSpan={columnCount} className="px-3 py-2">
                            <div className="max-w-xl space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Select
                                  value={draft?.action ?? row.action}
                                  onChange={(event) => {
                                    const action = event.target
                                      .value as ItemNameAiAction
                                    setEditError(null)
                                    setEditDraft((current) =>
                                      current
                                        ? {
                                            ...current,
                                            action,
                                            extras:
                                              action === 'components' &&
                                              current.extras.length === 0
                                                ? [newOptionExtraDraft()]
                                                : current.extras,
                                          }
                                        : current,
                                    )
                                  }}
                                  className="h-8 w-48 text-xs"
                                >
                                  <option value="hold">결정 필요</option>
                                  <option value="components">
                                    내품명을 구성품으로
                                  </option>
                                  <option value="delete">내품명만 비움</option>
                                </Select>
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={saveEdit}
                                >
                                  저장
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={closeEdit}
                                >
                                  취소
                                </Button>
                              </div>
                              {draft?.action === 'components' ? (
                                <InvoiceOptionExtrasEditor
                                  brandId={bulk.brandId}
                                  extras={extras}
                                  onChange={(next) => {
                                    setEditError(null)
                                    setEditDraft((current) =>
                                      current
                                        ? { ...current, extras: next }
                                        : current,
                                    )
                                  }}
                                  compact
                                />
                              ) : draft?.action === 'delete' ? (
                                <p className="text-[11px] text-muted-foreground">
                                  색상·사이즈처럼 본품 속성만 있으면 내품명을
                                  비웁니다.
                                </p>
                              ) : (
                                <p className="text-[11px] text-muted-foreground">
                                  구성품 또는 비움을 정하면 선택할 수 있습니다.
                                </p>
                              )}
                              {editError ? (
                                <p className="text-[11px] text-danger">
                                  {editError}
                                </p>
                              ) : (
                                <p className="text-[11px] text-muted-foreground">
                                  저장하기 전에는 목록 종류가 바뀌지 않습니다.
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
        </div>
      ) : null}
    </div>
  )
}
