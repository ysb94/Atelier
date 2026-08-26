import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  isProductNameAiSaveFailed,
  productNameAiMatchesWorkflowTab,
  productNameAiRowReadyToCommit,
  type ProductNameAiQuickSlot,
  type ProductNameAiReviewRow,
  type ProductNameAiWorkflowTab,
} from '@/lib/invoice/product-name-ai-review'
import { productNameCandidateKey } from '@/lib/invoice/product-name-patterns'
import {
  giftSourceGroupKey,
  type GiftSourceGroup,
} from '@/lib/invoice/gift-source-transform'
import type { UnresolvedProductNameCombo } from '@/lib/invoice/product-name-transform'
import type { StyleRef } from '@/lib/types'
import { formatNumber } from '@/lib/utils'
import {
  InvoiceOptionExtrasEditor,
  type OptionExtraDraft,
} from './InvoiceOptionExtrasEditor'
import { InvoiceProductLookupPopover } from './InvoiceProductLookupPopover'
import { InvoiceProductNameAiQuickSlots } from './InvoiceProductNameAiQuickSlots'
import { InvoiceProductNameSimilarStyles } from './InvoiceProductNameSimilarStyles'
import {
  extrasOfProductNameAiRow,
  useInvoiceProductNameBulkAiApply,
} from './useInvoiceProductNameBulkAiApply'
import { useInvoiceProductNameQuickEntry } from './useInvoiceProductNameQuickEntry'
import type { ProductMapHistoryEntry } from './useInvoiceProductNameSaveQueue'

const FILTERS: Array<{ value: ProductNameAiWorkflowTab; label: string }> = [
  { value: 'review', label: '검토 필요' },
  { value: 'ready', label: '준비 완료' },
  { value: 'failed', label: '저장 실패' },
]

const RULE_LABELS: Record<string, string> = {
  product: '품목명',
  item_full: '내품명',
  product_item: '품목명 + 내품명',
}

function ruleLabel(rule: string | null) {
  if (!rule) return '-'
  return RULE_LABELS[rule] ?? rule
}

function latestHistory(
  history: ProductMapHistoryEntry[],
  comboKey: string,
) {
  return history.find((entry) => entry.comboKey === comboKey) ?? null
}

export function InvoiceProductNameAiApplyBar({
  bulk,
  history,
  onExclude,
  excludePending,
  excludeError,
  giftGroups = [],
  onOpenGiftSetup,
}: {
  bulk: ReturnType<typeof useInvoiceProductNameBulkAiApply>
  history: ProductMapHistoryEntry[]
  onExclude: (combo: UnresolvedProductNameCombo) => void
  excludePending: boolean
  excludeError: string | null
  giftGroups?: GiftSourceGroup[]
  onOpenGiftSetup?: (row: ProductNameAiReviewRow) => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ProductNameAiWorkflowTab>('review')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [commitOpen, setCommitOpen] = useState(false)
  const previousPhase = useRef(bulk.phase)

  useEffect(() => {
    if (previousPhase.current !== 'review' && bulk.phase === 'review') {
      setFilter('review')
    }
    previousPhase.current = bulk.phase
  }, [bulk.phase])
  const quick = useInvoiceProductNameQuickEntry({
    brandId: bulk.brandId,
    rows: bulk.reviewRows,
    confirmedKeys: bulk.confirmedKeys,
    pendingAiKeys: bulk.pendingAiKeys,
    applySlots: bulk.applySlots,
    confirmRow: bulk.confirmRow,
    markPendingAi: bulk.markPendingAi,
    unconfirmRow: bulk.unconfirmRow,
  })

  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ko-KR')
    return bulk.reviewRows
      .filter((row) => {
        const saveFailed = isProductNameAiSaveFailed(
          latestHistory(history, row.key)?.status,
        )
        if (
          !productNameAiMatchesWorkflowTab(
            {
              confirmed: bulk.confirmedKeys.has(row.key),
              saveFailed,
              readyToCommit: productNameAiRowReadyToCommit(row),
            },
            filter,
          )
        ) {
          return false
        }
        if (!normalized) return true
        return [
          row.productName,
          row.itemName,
          row.mallName,
          row.lookupKey,
          row.style?.styleNo ?? '',
          row.style?.name ?? '',
          ...row.candidates.map((candidate) => candidate.text),
        ]
          .join(' ')
          .toLocaleLowerCase('ko-KR')
          .includes(normalized)
      })
      .sort(
        (left, right) =>
          left.productName.localeCompare(right.productName, 'ko-KR') ||
          left.itemName.localeCompare(right.itemName, 'ko-KR'),
      )
  }, [bulk.confirmedKeys, bulk.reviewRows, filter, history, query])

  useEffect(() => {
    if (!expandedKey) return
    if (!visibleRows.some((row) => row.key === expandedKey)) {
      setExpandedKey(null)
    }
  }, [expandedKey, visibleRows])

  const giftGroupByKey = useMemo(() => {
    const next = new Map<string, GiftSourceGroup>()
    for (const group of giftGroups) next.set(group.key, group)
    return next
  }, [giftGroups])

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">본품 확인 · AI 검수표</p>
          <p className="mt-1 text-xs text-muted-foreground">
            전체 AI 추천으로 초안을 채운 뒤 맞으면 Enter로 준비 완료로 넘깁니다.
            이름을 고친 행은 Enter로 표시한 뒤 공식명칭 완성을 쓰고, 결과를
            다시 확인한 다음 일괄 등록합니다.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {bulk.phase === 'collecting' ? (
            <Button type="button" size="sm" variant="ghost" onClick={bulk.cancel}>
              중단
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!bulk.routeReady || bulk.targetCount === 0}
              onClick={() => {
                quick.reset()
                void bulk.collect()
              }}
            >
              전체 AI 추천
            </Button>
          )}
        </div>
      </div>

      {bulk.routeLoading ? (
        <p className="text-xs text-muted-foreground">AI 설정을 불러오는 중...</p>
      ) : !bulk.routeReady ? (
        <p className="text-xs text-muted-foreground">
          설정 → AI 설정에서 모델을 켜면 전체 추천과 공식명칭 완성을 쓸 수
          있습니다.
        </p>
      ) : null}

      {bulk.phase === 'collecting' ? (
        <p className="text-xs text-muted-foreground">
          {formatNumber(bulk.progress.done)} / {formatNumber(bulk.progress.total)}
          추천을 모으는 중...
        </p>
      ) : null}

      {bulk.phase === 'idle' && bulk.reviewRows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          남은 {formatNumber(bulk.targetCount)}개 조합에 전체 AI 추천을 누르면
          검수표가 채워집니다.
        </p>
      ) : null}

      {bulk.reviewRows.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`rounded-full border px-2 py-0.5 text-[11px] ${
                  filter === item.value
                    ? 'border-foreground text-foreground'
                    : 'border-border text-muted-foreground'
                }`}
                onClick={() => setFilter(item.value)}
              >
                {item.label}{' '}
                {item.value === 'review'
                  ? formatNumber(bulk.reviewCount)
                  : item.value === 'ready'
                    ? formatNumber(bulk.readyCount)
                    : formatNumber(bulk.saveFailedCount)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="품목명·내품명·조회 키 검색"
              aria-label="품목명 검수표 검색"
              className="h-8 max-w-xs text-xs"
            />
            {filter === 'review' ? (
              <>
                {bulk.failedCollectCount > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    disabled={!bulk.routeReady || bulk.phase === 'collecting'}
                    onClick={() => void bulk.retryFailed()}
                  >
                    추천 실패 재시도 {formatNumber(bulk.failedCollectCount)}
                  </Button>
                ) : null}
                <InvoiceProductLookupPopover brandId={bulk.brandId} />
                <div className="ml-auto flex items-center gap-2">
                  {quick.resolving ? (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:underline"
                      onClick={quick.cancel}
                    >
                      중단
                    </button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    disabled={
                      quick.pendingCount === 0 ||
                      quick.resolving ||
                      !quick.routeReady
                    }
                    onClick={() => void quick.resolve()}
                  >
                    {quick.resolving
                      ? `완성 중 ${quick.progress.done}/${quick.progress.total}`
                      : `AI 공식명칭 완성 ${formatNumber(quick.pendingCount)}`}
                  </Button>
                </div>
              </>
            ) : null}
            {filter === 'ready' ? (
              <Button
                type="button"
                size="sm"
                className="h-7 px-2 text-[11px]"
                disabled={!bulk.canCommit}
                onClick={() => setCommitOpen(true)}
              >
                검토 완료 · 일괄 등록 {formatNumber(bulk.readyCount)}
              </Button>
            ) : null}
            {filter === 'failed' ? (
              <Button
                type="button"
                size="sm"
                className="h-7 px-2 text-[11px]"
                disabled={bulk.saveFailedCount === 0 || bulk.phase === 'collecting'}
                onClick={() => bulk.retrySaveFailed(history)}
              >
                저장 재시도 {formatNumber(bulk.saveFailedCount)}
              </Button>
            ) : null}
          </div>
          {quick.resolveError ||
          (!quick.routeReady && !quick.routeLoading) ? (
            <p className="text-[11px] text-danger">
              {quick.resolveError ||
                '상품 추천 라우트가 꺼져 있어 공식명칭을 완성할 수 없습니다.'}
            </p>
          ) : null}
          {bulk.applyError ? (
            <p className="text-[11px] text-danger">{bulk.applyError}</p>
          ) : null}
          {excludeError ? (
            <p className="text-[11px] text-danger">{excludeError}</p>
          ) : null}
          <div
            data-product-name-ai-scroll
            className="max-h-[min(72vh,56rem)] overflow-auto rounded-md border border-border bg-card"
          >
            <table className="w-full table-fixed text-left text-xs">
              <thead className="sticky top-0 z-10 bg-muted/90">
                <tr>
                  <th className="w-[26%] px-2 py-1.5 font-medium">품목명</th>
                  <th className="w-[20%] px-2 py-1.5 font-medium">내품명</th>
                  <th className="w-[32%] px-2 py-1.5 font-medium">조회 키</th>
                  <th className="w-[22%] px-2 py-1.5 font-medium">
                    이름 입력 · 본품
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-2 py-6 text-center text-muted-foreground"
                    >
                      {filter === 'review' &&
                      bulk.reviewCount === 0 &&
                      !query.trim()
                        ? '검토가 끝났습니다. 준비 완료 탭에서 등록하세요.'
                        : '이 필터에 해당하는 행이 없습니다.'}
                    </td>
                  </tr>
                ) : null}
                {visibleRows.map((row, index) => (
                  <ProductNameAiReviewTableRow
                    key={row.key}
                    brandId={bulk.brandId}
                    row={row}
                    slots={quick.getSlots(row)}
                    historyEntry={latestHistory(history, row.key)}
                    stageError={quick.stageErrorByKey.get(row.key) ?? null}
                    expanded={expandedKey === row.key}
                    striped={index % 2 === 1}
                    resolving={quick.resolving || bulk.phase === 'collecting'}
                    excludePending={excludePending}
                    onLookupKey={(lookupKey) =>
                      bulk.updateRow(row.key, { lookupKey })
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
                    onRegister={(slotIndex, el) =>
                      quick.registerInput(row.key, slotIndex, el)
                    }
                    onEnter={(slotIndex) =>
                      quick.confirmAndMove(visibleRows, row.key, slotIndex)
                    }
                    onTab={(slotIndex) =>
                      quick.moveRight(visibleRows, row.key, slotIndex)
                    }
                    onToggleExpand={() =>
                      setExpandedKey((current) =>
                        current === row.key ? null : row.key,
                      )
                    }
                    pendingAi={bulk.pendingAiKeys.has(row.key)}
                    confirmed={
                      bulk.confirmedKeys.has(row.key) &&
                      productNameAiRowReadyToCommit(row)
                    }
                    onUnconfirm={() => bulk.unconfirmRow(row.key)}
                    onExtrasChange={(next) =>
                      bulk.updateRow(row.key, { extras: next })
                    }
                    onExclude={onExclude}
                    giftGroup={
                      giftGroupByKey.get(
                        giftSourceGroupKey(row.mallName, row.productName),
                      ) ?? null
                    }
                    onOpenGiftSetup={
                      onOpenGiftSetup ? () => onOpenGiftSetup(row) : undefined
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {commitOpen ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
          <p className="text-xs">
            본품 공식명칭이 완성된 {formatNumber(bulk.readyCount)}개를
            원장에 등록합니다. 미완성·후보 선택 남은 행은 건너뜁니다.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setCommitOpen(false)}
            >
              취소
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                bulk.applyReady()
                setCommitOpen(false)
              }}
            >
              등록
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const ProductNameAiReviewTableRow = memo(function ProductNameAiReviewTableRow({
  brandId,
  row,
  slots,
  historyEntry,
  stageError,
  expanded,
  striped,
  resolving,
  excludePending,
  onLookupKey,
  onTextChange,
  onPickStyle,
  onClear,
  onRegister,
  onEnter,
  onTab,
  onToggleExpand,
  pendingAi,
  confirmed,
  onUnconfirm,
  onExtrasChange,
  onExclude,
  giftGroup,
  onOpenGiftSetup,
}: {
  brandId: string
  row: ProductNameAiReviewRow
  slots: ProductNameAiQuickSlot[]
  historyEntry: ProductMapHistoryEntry | null
  stageError: string | null
  expanded: boolean
  striped: boolean
  resolving: boolean
  excludePending: boolean
  onLookupKey: (lookupKey: string) => void
  onTextChange: (slotIndex: number, text: string) => void
  onPickStyle: (slotIndex: number, style: StyleRef) => void
  onClear: (slotIndex: number) => void
  onRegister: (slotIndex: number, el: HTMLInputElement | null) => void
  onEnter: (slotIndex: number) => void
  onTab: (slotIndex: number) => void
  onToggleExpand: () => void
  pendingAi: boolean
  confirmed: boolean
  onUnconfirm: () => void
  onExtrasChange: (next: OptionExtraDraft[]) => void
  onExclude: (combo: UnresolvedProductNameCombo) => void
  giftGroup: GiftSourceGroup | null
  onOpenGiftSetup?: () => void
}) {
  const saving =
    historyEntry?.status === 'queued' || historyEntry?.status === 'saving'
  const tone = pendingAi
    ? 'bg-success/10'
    : striped
      ? 'bg-muted/40'
      : 'bg-card'
  const rowClass = `border-t border-border ${tone}`
  const lookupRowSpan = expanded ? 3 : 2
  return (
    <>
      <tr className={rowClass}>
        <td className="break-words px-2 py-1.5 align-top">
          <p>{row.productName}</p>
          <p className="text-[11px] text-muted-foreground">
            {row.mallName || '모든 쇼핑몰'}
            {row.rowCount > 1 ? ` · ${formatNumber(row.rowCount)}행` : ''}
          </p>
          {giftGroup ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {giftGroup.status === 'assigned' ? (
                <Badge variant="success">사은품 변환 완료</Badge>
              ) : giftGroup.status === 'map_found' ? (
                <Badge variant="warning">기존 사은품 설정</Badge>
              ) : (
                <Badge variant="outline">사은품 추천</Badge>
              )}
            </div>
          ) : null}
        </td>
        <td className="break-words px-2 py-1.5 align-top">
          {row.itemName || '내품명 없음'}
        </td>
        <td className="px-2 py-1.5 align-top" rowSpan={lookupRowSpan}>
          <div className="space-y-0.5">
            {row.registrationCandidates.map((candidate) => {
              const selected = row.lookupKey === candidate.text
              return (
                <button
                  key={productNameCandidateKey(candidate)}
                  type="button"
                  disabled={saving || resolving}
                  className={`flex w-full items-baseline gap-1.5 rounded text-left ${
                    selected
                      ? 'border border-primary/50 bg-primary/15 px-1.5 py-0.5 text-[13px]! font-semibold! text-primary'
                      : 'px-1.5 py-0.5 text-muted-foreground hover:bg-muted/40'
                  }`}
                  title={`${ruleLabel(candidate.rule)} · ${candidate.text}`}
                  onClick={() => onLookupKey(candidate.text)}
                >
                  <span className="w-[5.75rem] shrink-0 text-center text-[10px]">
                    {selected ? '✓ ' : ''}
                    {ruleLabel(candidate.rule)}
                  </span>
                  <span className="min-w-0 break-words">{candidate.text}</span>
                </button>
              )
            })}
          </div>
        </td>
        <td className="px-2 py-1.5 align-top">
          <InvoiceProductNameAiQuickSlots
            rowKey={row.key}
            slots={slots}
            disabled={saving || resolving}
            onTextChange={onTextChange}
            onPickStyle={onPickStyle}
            onClear={onClear}
            onRegister={onRegister}
            onEnter={onEnter}
            onTab={onTab}
          />
          {!row.style ? (
            <InvoiceProductNameSimilarStyles
              brandId={brandId}
              lookupKey={row.lookupKey}
              productName={row.productName}
              disabled={saving || resolving}
              onPick={(style) => onPickStyle(0, style)}
            />
          ) : null}
          {stageError ? (
            <p className="mt-1 text-[10px] text-danger">{stageError}</p>
          ) : null}
        </td>
      </tr>
      <tr className={tone}>
        <td className="px-2 pb-1.5 align-top">
          <div className="rounded-md border border-border/80 bg-muted/40 px-2 py-1.5">
            <p className="break-words text-[11px] text-muted-foreground">
              {row.style
                ? `${row.style.styleNo} · ${row.style.name}`
                : '본품 미정'}
            </p>
            {row.extras.length > 0 ? (
              <p className="mt-1 text-[10px] text-muted-foreground">
                구성{' '}
                {row.extras
                  .map((item) => `${item.style.styleNo} · ${item.style.name}`)
                  .join(', ')}
              </p>
            ) : null}
            {row.message && row.holdReason !== 'low_confidence' ? (
              <p className="mt-1 text-[10px] text-muted-foreground">{row.message}</p>
            ) : null}
            {historyEntry?.error ? (
              <p className="mt-1 text-[10px] text-danger">{historyEntry.error}</p>
            ) : null}
          </div>
        </td>
        <td className="px-2 pb-1.5 align-top" />
        <td className="px-2 pb-1.5 align-top">
          <div className="flex flex-wrap justify-end gap-1">
            {onOpenGiftSetup ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                disabled={resolving}
                onClick={onOpenGiftSetup}
              >
                사은품 처리
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              disabled={resolving}
              onClick={onToggleExpand}
            >
              {expanded ? '구성 접기' : '구성'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              disabled={!row.mallName.trim() || excludePending || resolving}
              onClick={() =>
                onExclude({
                  key: row.key,
                  mallName: row.mallName,
                  productName: row.productName,
                  itemName: row.itemName,
                  ownProductCode: row.ownProductCode,
                  rowCount: row.rowCount,
                  status:
                    row.holdReason === 'exclusion_guarded'
                      ? 'exclusion_guarded'
                      : row.isConflict
                        ? 'conflict'
                        : 'unresolved',
                  appliedRule: row.appliedRule,
                  appliedLookupKey: row.lookupKey,
                  candidateStyles: row.style ? [row.style] : [],
                  candidates: row.candidates,
                  tags: [],
                  itemTags: [],
                })
              }
            >
              연결 예외
            </Button>
            {confirmed ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                disabled={resolving}
                onClick={onUnconfirm}
              >
                다시 검토
              </Button>
            ) : null}
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr className={tone}>
          <td className="px-2 pb-1.5 align-top" colSpan={2}>
            <div className="space-y-2 rounded-md border border-border/80 bg-muted/40 px-2 py-1.5">
              <InvoiceOptionExtrasEditor
                brandId={brandId}
                extras={extrasOfProductNameAiRow(row)}
                onChange={onExtrasChange}
                compact
              />
            </div>
          </td>
          <td className="px-2 pb-1.5" />
        </tr>
      ) : null}
    </>
  )
})
