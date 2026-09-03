import { useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tabs'
import { StylePicker } from '@/components/style-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ITEM_NAME_AI_PAGE_SIZES,
  ITEM_NAME_AI_QUICK_SLOT_LIMIT,
  itemNameAiExpectedLines,
  itemNameAiMatchesQueueFilter,
  itemNameAiReviewKind,
  nextItemNameAiReviewPage,
  paginateItemNameAiReviewKeys,
  type ItemNameAiQueueFilter,
  type ItemNameAiReviewKind,
} from '@/lib/invoice/item-name-ai-review'
import { logInvoiceWork } from '@/lib/invoice/invoice-work-perf'
import { productCompositionSearchText } from '@/lib/invoice/product-composition'
import type { StyleRef } from '@/lib/types'
import { formatNumber } from '@/lib/utils'
import { ProductCompositionLines } from './ProductCompositionLines'
import { InvoiceItemNameAiQuickSlots } from './InvoiceItemNameAiQuickSlots'
import { useInvoiceItemNameBulkAiApply } from './useInvoiceItemNameBulkAiApply'
import { useInvoiceItemNameQuickEntry } from './useInvoiceItemNameQuickEntry'

const REVIEW_FILTERS: Array<{
  value: Exclude<ItemNameAiQueueFilter, 'hold'>
  label: string
}> = [
  { value: 'queue', label: '입력 대기' },
  { value: 'delete', label: '내품명 비움' },
  { value: 'single', label: '옵션 상품 1개' },
  { value: 'bundle', label: '구성 2개 이상' },
]

export function InvoiceItemNameAiApplyBar({
  bulk,
}: {
  bulk: ReturnType<typeof useInvoiceItemNameBulkAiApply>
}) {
  const workspaceActive = useWorkspaceTabActivity()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ItemNameAiQueueFilter>('queue')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] =
    useState<(typeof ITEM_NAME_AI_PAGE_SIZES)[number]>(20)
  const quick = useInvoiceItemNameQuickEntry({
    brandId: bulk.brandId,
    rows: bulk.reviewRows,
    confirmedKeys: bulk.confirmedKeys,
    pendingAiKeys: bulk.pendingAiKeys,
    stageRowComponents: bulk.stageRowComponents,
    stageRowDelete: bulk.stageRowDelete,
    unstageRow: bulk.unstageRow,
    confirmRow: bulk.confirmRow,
    unconfirmRow: bulk.unconfirmRow,
    commitRow: bulk.commitRow,
  })
  const [bulkAppendMode, setBulkAppendMode] = useState(false)
  const [appendTargets, setAppendTargets] = useState<Set<string>>(new Set())
  const [appendStyle, setAppendStyle] = useState<StyleRef | null>(null)
  const [appendQty, setAppendQty] = useState(1)
  const [appendError, setAppendError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [dialog, setDialog] = useState<
    'bulk-append' | 'quick-entry' | 'reset' | null
  >(null)
  const pendingPageFocusRef = useRef(false)

  useEffect(() => {
    const liveKeys = new Set(bulk.reviewRows.map((row) => row.key))
    setAppendTargets((current) => {
      let changed = false
      const next = new Set<string>()
      for (const key of current) {
        if (liveKeys.has(key)) next.add(key)
        else changed = true
      }
      return changed ? next : current
    })
    if (liveKeys.size === 0) {
      setAppendError(null)
      setBulkAppendMode(false)
      setDialog((current) => (current === 'reset' ? current : null))
    }
  }, [bulk.reviewRows])

  function resetLocalUi() {
    setQuery('')
    setFilter('queue')
    setBulkAppendMode(false)
    setAppendTargets(new Set())
    setAppendStyle(null)
    setAppendQty(1)
    setAppendError(null)
    setCollapsed(false)
  }

  const kindCounts = useMemo(() => {
    const counts: Record<Exclude<ItemNameAiReviewKind, 'hold'>, number> = {
      delete: 0,
      single: 0,
      bundle: 0,
    }
    for (const row of bulk.reviewRows) {
      if (!bulk.committedKeys.has(row.key)) continue
      const kind = itemNameAiReviewKind(row)
      if (kind === 'hold') continue
      counts[kind] += 1
    }
    return counts
  }, [bulk.committedKeys, bulk.reviewRows])
  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ko-KR')
    return bulk.reviewRows
      .filter((row) => {
        const shown = bulk.draftByKey.get(row.key) ?? row
        if (
          !itemNameAiMatchesQueueFilter(shown, filter, bulk.committedKeys)
        ) {
          return false
        }
        if (!normalized) return true
        return [
          row.itemName,
          row.productLookupKey,
          row.mainStyle?.styleNo ?? '',
          row.mainStyle?.name ?? '',
          productCompositionSearchText(row.productComponents),
          ...itemNameAiExpectedLines(shown),
          ...quick.getSlots(shown).map((slot) => slot.text),
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
  }, [
    bulk.committedKeys,
    bulk.draftByKey,
    bulk.reviewRows,
    filter,
    query,
    quick,
  ])

  useEffect(() => {
    setPage(1)
  }, [filter, query, pageSize])

  const paged = useMemo(
    () =>
      paginateItemNameAiReviewKeys(
        visibleRows.map((row) => row.key),
        page,
        pageSize,
      ),
    [page, pageSize, visibleRows],
  )

  useEffect(() => {
    if (paged.page !== page) setPage(paged.page)
  }, [page, paged.page])

  const pagedRows = useMemo(() => {
    const byKey = new Map(visibleRows.map((row) => [row.key, row]))
    return paged.keys
      .map((key) => byKey.get(key))
      .filter((row): row is (typeof visibleRows)[number] => Boolean(row))
  }, [paged.keys, visibleRows])

  useEffect(() => {
    logInvoiceWork('ai-review-render', {
      kind: 'item',
      visible: visibleRows.length,
      page: pagedRows.length,
      pageSize,
    })
  }, [pageSize, pagedRows.length, visibleRows.length])

  useEffect(() => {
    if (!pendingPageFocusRef.current) return
    pendingPageFocusRef.current = false
    const first = pagedRows[0]
    if (first) quick.focusSlot(first.key, 0)
  }, [page, pagedRows, quick])

  const selectableRows = visibleRows.filter(
    (row) =>
      bulk.committedKeys.has(row.key) &&
      row.action !== 'hold' &&
      !row.validationError,
  )
  const pageSelectableRows = pagedRows.filter(
    (row) =>
      bulk.committedKeys.has(row.key) &&
      row.action !== 'hold' &&
      !row.validationError,
  )
  const selectedVisibleCount = selectableRows.filter((row) =>
    bulk.selected.has(row.key),
  ).length
  const selectedPageCount = pageSelectableRows.filter((row) =>
    bulk.selected.has(row.key),
  ).length
  const allVisibleSelected =
    selectableRows.length > 0 &&
    selectedVisibleCount === selectableRows.length
  const allPageSelected =
    pageSelectableRows.length > 0 &&
    selectedPageCount === pageSelectableRows.length

  const columnCount = bulkAppendMode ? 7 : 6
  const blockBulkAppend =
    quick.pendingCount > 0 || quick.resolving || bulk.hasDraftChanges
  const appendTargetPageCount = pagedRows.filter((row) =>
    appendTargets.has(row.key),
  ).length
  const allPageAppendTargets =
    pagedRows.length > 0 && appendTargetPageCount === pagedRows.length

  function togglePage(checked: boolean) {
    for (const row of pageSelectableRows) {
      const selected = bulk.selected.has(row.key)
      if (checked !== selected) bulk.toggle(row.key)
    }
  }

  function toggleFiltered(checked: boolean) {
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

  function togglePageAppendTargets(checked: boolean) {
    setAppendTargets((current) => {
      const next = new Set(current)
      for (const row of pagedRows) {
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

  function discardBulkAppend() {
    bulk.discardDrafts()
    setAppendTargets(new Set())
    setAppendError(null)
    setBulkAppendMode(false)
  }

  function closeBulkAppendMode() {
    if (bulk.hasDraftChanges) {
      setDialog('bulk-append')
      return
    }
    discardBulkAppend()
  }

  function confirmDialog() {
    if (dialog === 'bulk-append') discardBulkAppend()
    if (dialog === 'quick-entry') {
      bulk.discardDrafts()
      quick.reset()
    }
    if (dialog === 'reset') {
      bulk.reset()
      quick.reset()
      resetLocalUi()
    }
    setDialog(null)
  }

  function openBulkAppendMode() {
    setAppendError(null)
    setBulkAppendMode(true)
  }

  async function registerSelected() {
    const registeredCount = await bulk.applySelected()
    if (registeredCount > 0 && bulk.queueCount > 0) {
      setFilter('queue')
    }
  }

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">AI 내품명 추천</p>
          <p className="mt-1 text-xs text-muted-foreground">
            미설정 옵션 {formatNumber(bulk.groupCount)}개를 실제 조회 키 조합별로
            추천합니다. 구성품을 입력하고 Enter로 분류한 뒤 선택한 행만
            등록됩니다.
          </p>
        </div>
        {bulk.phase === 'collecting' ? (
          <Button type="button" size="sm" variant="ghost" onClick={bulk.cancel}>
            중단
          </Button>
        ) : bulk.phase === 'review' || bulk.phase === 'applied' ? (
          <div className="flex shrink-0 gap-2">
            {bulk.reviewRows.length > 0 && !collapsed ? (
              <Button
                type="button"
                size="sm"
                disabled={bulk.selectedCount === 0 || bulk.applying}
                onClick={() => void registerSelected()}
              >
                {bulk.applying
                  ? '저장 중...'
                  : `선택 ${formatNumber(bulk.selectedCount)}개 등록`}
              </Button>
            ) : null}
            {bulk.reviewRows.length > 0 ? (
              collapsed ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setCollapsed(false)}
                >
                  검수표 열기
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setCollapsed(true)}
                >
                  닫기
                </Button>
              )
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setDialog('reset')}
            >
              처음부터
            </Button>
          </div>
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

      {bulk.appliedCount > 0 ? (
        <p className="mt-2 text-xs">
          최근 {formatNumber(bulk.appliedCount)}개 조합 등록
          {bulk.failedCount
            ? ` · 실패 ${formatNumber(bulk.failedCount)}개`
            : ''}
        </p>
      ) : null}

      {bulk.applyError ? (
        <p className="mt-2 text-xs text-danger">{bulk.applyError}</p>
      ) : null}

      {collapsed &&
      bulk.reviewRows.length > 0 &&
      (bulk.phase === 'review' || bulk.phase === 'applied') ? (
        <p className="mt-2 text-xs text-muted-foreground">
          입력 대기 {formatNumber(bulk.queueCount)}개 · 저장 완료{' '}
          {formatNumber(bulk.committedCount)}개 · 등록 선택{' '}
          {formatNumber(bulk.selectedCount)}개
        </p>
      ) : null}

      {!collapsed &&
      (bulk.phase === 'review' ||
        bulk.phase === 'applied' ||
        (bulk.phase === 'collecting' && bulk.reviewRows.length > 0)) ? (
        <div className="mt-3 space-y-2">
          <div
            className="flex flex-wrap gap-1"
            role="tablist"
            aria-label="예상 변환 종류"
          >
            {REVIEW_FILTERS.map((item) => {
              const count =
                item.value === 'queue'
                  ? bulk.queueCount
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
              입력 대기 {formatNumber(bulk.queueCount)}개 · 저장 완료{' '}
              {formatNumber(bulk.committedCount)}개
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
              className="text-xs text-primary hover:underline"
              disabled={selectableRows.length === 0}
              onClick={() => toggleFiltered(!allVisibleSelected)}
            >
              {allVisibleSelected
                ? '검색 결과 선택 해제'
                : `검색 결과 전체 선택 ${formatNumber(selectableRows.length)}`}
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
              } ${
                !bulkAppendMode && blockBulkAppend
                  ? 'pointer-events-none opacity-50'
                  : ''
              }`}
              aria-pressed={bulkAppendMode}
              disabled={!bulkAppendMode && blockBulkAppend}
              onClick={() => {
                if (bulkAppendMode) closeBulkAppendMode()
                else openBulkAppendMode()
              }}
            >
              {bulkAppendMode ? '일괄 넣기 닫기' : '구성품 일괄 넣기'}
            </button>
            <Button
              type="button"
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={
                bulkAppendMode ||
                quick.pendingCount === 0 ||
                quick.resolving ||
                !quick.routeReady
              }
              onClick={() => void quick.resolve()}
            >
              {quick.resolving
                ? `정리 중 ${quick.progress.done}/${quick.progress.total}`
                : 'AI 공식명칭 정리'}
            </Button>
            {quick.resolving ? (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:underline"
                onClick={quick.cancel}
              >
                중단
              </button>
            ) : null}
            {!bulkAppendMode && bulk.hasDraftChanges ? (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:underline"
                onClick={() => setDialog('quick-entry')}
              >
                초안 버리기
              </button>
            ) : null}
          </div>
          {quick.resolveError ||
          (!quick.routeReady && !quick.routeLoading) ? (
            <p className="text-[11px] text-danger">
              {quick.resolveError ||
                '상품 추천 라우트가 꺼져 있어 공식명칭을 정리할 수 없습니다.'}
            </p>
          ) : null}

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
                  선택한 행은 바로 분류됩니다. DB 등록은 아니며 실행 취소로
                  되돌릴 수 있습니다.
                </p>
              )}
            </div>
          ) : null}

          <div
            data-item-name-ai-scroll
            className="max-h-[32rem] overflow-auto rounded-md border border-border bg-card"
          >
            <table className="w-full min-w-[72rem] text-left text-xs">
              <thead className="sticky top-0 z-10 bg-muted/90">
                <tr>
                  <th className="w-10 px-2 py-1.5">
                    <input
                      type="checkbox"
                      aria-label="현재 페이지 추천 전체 선택"
                      checked={allPageSelected}
                      disabled={pageSelectableRows.length === 0}
                      onChange={(event) => togglePage(event.target.checked)}
                    />
                  </th>
                  {bulkAppendMode ? (
                    <th className="min-w-24 px-2 py-1.5">
                      <div className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            aria-label="현재 페이지 추가 대상 전체 선택"
                            checked={allPageAppendTargets}
                            disabled={pagedRows.length === 0}
                            onChange={(event) =>
                              togglePageAppendTargets(event.target.checked)
                            }
                          />
                        <span className="font-medium">추가 대상</span>
                      </div>
                    </th>
                  ) : null}
                  <th className="px-2 py-1.5 font-medium">조회 키</th>
                  <th className="px-2 py-1.5 font-medium">옵션명</th>
                  <th className="px-2 py-1.5 font-medium">구성품 빠른 입력</th>
                  <th className="px-2 py-1.5 font-medium">상태</th>
                  <th className="px-2 py-1.5 font-medium">대상 행</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columnCount}
                      className="px-2 py-6 text-center text-muted-foreground"
                    >
                      {filter === 'queue'
                        ? '입력 대기 행이 없습니다.'
                        : '분류된 행이 없습니다.'}
                    </td>
                  </tr>
                ) : null}
                {pagedRows.map((row, index) => {
                  const shown = bulk.draftByKey.get(row.key) ?? row
                  const committed = bulk.committedKeys.has(row.key)
                  const pendingAi = bulk.pendingAiKeys.has(row.key)
                  const disabled = Boolean(
                    !committed ||
                      shown.action === 'hold' ||
                      shown.validationError,
                  )
                  const tone = pendingAi
                    ? 'bg-success/10'
                    : index % 2 === 1
                      ? 'bg-muted/40'
                      : 'bg-card'
                  return (
                    <tr
                      key={row.key}
                      className={`border-t border-border ${tone}`}
                    >
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          aria-label={`${row.productLookupKey || row.itemName} 선택`}
                          checked={committed && bulk.selected.has(row.key)}
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
                      <td className="px-2 py-1.5 align-top">
                        <InvoiceItemNameAiQuickSlots
                          brandId={bulk.brandId}
                          rowKey={row.key}
                          slots={quick.getSlots(shown)}
                          disabled={
                            bulkAppendMode || quick.resolving || committed
                          }
                          showDeleteLabel={
                            committed && shown.action === 'delete'
                          }
                          onTextChange={(slotIndex, text) =>
                            quick.setSlotText(row.key, slotIndex, text)
                          }
                          onPickStyle={(slotIndex, style) =>
                            quick.pickSlotStyle(row.key, slotIndex, style)
                          }
                          onClear={(slotIndex) =>
                            quick.clearSlot(row.key, slotIndex)
                          }
                          onRemoveExtra={(slotIndex) =>
                            quick.removeSlot(row.key, slotIndex)
                          }
                          onRegister={(slotIndex, el) =>
                            quick.registerInput(row.key, slotIndex, el)
                          }
                          onEnter={(slotIndex) => {
                            const last = pagedRows[pagedRows.length - 1]
                            const lastSlot = quick.getSlots(shown).length - 1
                            const nextPage = nextItemNameAiReviewPage(
                              paged.page,
                              paged.pageCount,
                              paged.keys,
                              row.key,
                            )
                            const isLastInput =
                              last?.key === row.key && slotIndex === lastSlot
                            quick.confirmAndMove(
                              pagedRows,
                              row.key,
                              slotIndex,
                            )
                            if (isLastInput && nextPage != null) {
                              pendingPageFocusRef.current = true
                              setPage(nextPage)
                            }
                          }}
                          onTab={(slotIndex) =>
                            quick.moveRight(pagedRows, row.key, slotIndex)
                          }
                          onAddExtra={() => {
                            const currentCount = quick.getSlots(shown).length
                            if (currentCount >= ITEM_NAME_AI_QUICK_SLOT_LIMIT) {
                              return
                            }
                            const nextCount = currentCount + 1
                            quick.ensureSlotCount(row.key, nextCount, shown)
                            quick.focusSlot(row.key, nextCount - 1)
                          }}
                        />
                      </td>
                      <td className="max-w-72 px-2 py-1.5">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {committed ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-6 shrink-0 px-2 text-[11px]"
                                disabled={quick.resolving}
                                onClick={() => {
                                  bulk.reopenRow(row.key)
                                  setFilter('queue')
                                }}
                              >
                                다시 입력
                              </Button>
                            ) : null}
                          </div>
                          {shown.validationError ? (
                            <p className="text-[11px] text-danger">
                              {shown.validationError}
                            </p>
                          ) : null}
                          {quick.stageErrorByKey.get(row.key) ? (
                            <p className="text-[11px] text-danger">
                              {quick.stageErrorByKey.get(row.key)}
                            </p>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">
                        {formatNumber(row.rowCount)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {visibleRows.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <p className="text-muted-foreground">
                검색 {formatNumber(visibleRows.length)}개 중{' '}
                {formatNumber((paged.page - 1) * paged.pageSize + 1)}–
                {formatNumber(
                  Math.min(visibleRows.length, paged.page * paged.pageSize),
                )}
                행
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-muted-foreground">
                  페이지 크기
                  <select
                    className="h-7 rounded-md border border-border bg-card px-1 text-xs"
                    value={pageSize}
                    onChange={(event) =>
                      setPageSize(
                        Number(event.target.value) as (typeof ITEM_NAME_AI_PAGE_SIZES)[number],
                      )
                    }
                  >
                    {ITEM_NAME_AI_PAGE_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2"
                  disabled={paged.page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  이전
                </Button>
                <span className="tabular-nums text-muted-foreground">
                  {formatNumber(paged.page)} / {formatNumber(paged.pageCount)}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2"
                  disabled={paged.page >= paged.pageCount}
                  onClick={() =>
                    setPage((current) =>
                      Math.min(paged.pageCount, current + 1),
                    )
                  }
                >
                  다음
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {workspaceActive && dialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="닫기"
            className="absolute inset-0 bg-black/40"
            onClick={() => setDialog(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="item-name-ai-dialog-title"
            className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-card p-4 shadow-xl"
          >
            <h2
              id="item-name-ai-dialog-title"
              className="text-sm font-semibold"
            >
              {dialog === 'reset'
                ? '처음부터 시작할까요?'
                : '초안을 버릴까요?'}
            </h2>
            <p className="mt-2 text-xs text-muted-foreground">
              {dialog === 'reset'
                ? 'AI 추천과 입력한 검수 내용이 모두 지워지고 추천 모으기부터 다시 시작합니다.'
                : dialog === 'bulk-append'
                  ? '저장하지 않은 일괄 변경을 버립니다. 검수표에는 반영되지 않습니다.'
                  : '저장하지 않은 빠른 입력 변경을 버립니다. 검수표에는 반영되지 않습니다.'}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setDialog(null)}
              >
                취소
              </Button>
              <Button
                type="button"
                size="sm"
                variant="danger"
                onClick={confirmDialog}
              >
                {dialog === 'reset' ? '처음부터' : '버리기'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
