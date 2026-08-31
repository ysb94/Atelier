import { Fragment, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type {
  InvoiceStockHoldReason,
  StockHoldBundleLine,
  StockHoldCandidateBundle,
} from '@/lib/invoice/stock-hold-match'
import {
  excludedRowNumbersFromStockHoldBundles,
} from '@/lib/invoice/stock-hold-match'
import { cn, formatNumber } from '@/lib/utils'

export type { InvoiceStockHoldReason, StockHoldCandidateBundle }

const REASON_FILTERS: {
  value: 'all' | InvoiceStockHoldReason
  label: string
}[] = [
  { value: 'all', label: '전체' },
  { value: 'discontinued', label: '단종' },
  { value: 'out_of_stock', label: '재고부족' },
  { value: 'reservation', label: '예약발송' },
]

const REASON_LABEL: Record<InvoiceStockHoldReason, string> = {
  discontinued: '단종',
  out_of_stock: '재고부족',
  reservation: '예약발송',
}

const REASON_BADGE: Record<
  InvoiceStockHoldReason,
  'danger' | 'warning' | 'muted'
> = {
  discontinued: 'danger',
  out_of_stock: 'warning',
  reservation: 'muted',
}

/** 같은 합포장 행을 이어 보이게 하는 배경. 합포장마다 번갈아 쓴다. */
const BUNDLE_STRIPE = ['bg-sky-500/10', 'bg-amber-500/10'] as const

type LiveLine = StockHoldBundleLine
type LiveBundle = Omit<StockHoldCandidateBundle, 'lines' | 'excluded'> & {
  lines: LiveLine[]
  excluded: boolean
}

type ProductSummary = {
  styleId: string
  styleNo: string
  styleName: string
  reason: Exclude<InvoiceStockHoldReason, 'out_of_stock'>
  detail: string
  bundleCount: number
  matchedRowCount: number
  affectedRowCount: number
  excludedRowCount: number
  releasedRowCount: number
}

export function InvoiceStockHoldStepPanel({
  bundles = [],
  loading = false,
  onExcludedRowNumbersChange,
}: {
  bundles?: StockHoldCandidateBundle[]
  loading?: boolean
  onExcludedRowNumbersChange?: (rowNumbers: number[]) => void
}) {
  const [filter, setFilter] = useState<'all' | InvoiceStockHoldReason>('all')
  const [productStyleId, setProductStyleId] = useState<string | null>(null)
  /** rowNumber → excluded. 기본은 출고 제외(true). 체크하면 false(진행). */
  const [draftByRow, setDraftByRow] = useState(() => {
    const next = new Map<number, boolean>()
    for (const bundle of bundles) {
      for (const line of bundle.lines) {
        next.set(line.rowNumber, line.excluded)
      }
    }
    return next
  })

  useEffect(() => {
    setDraftByRow((current) => {
      const next = new Map<number, boolean>()
      for (const bundle of bundles) {
        for (const line of bundle.lines) {
          next.set(line.rowNumber, current.get(line.rowNumber) ?? line.excluded)
        }
      }
      return next
    })
  }, [bundles])

  const liveBundles = useMemo<LiveBundle[]>(
    () =>
      bundles.map((bundle) => {
        const lines = bundle.lines.map((line) => ({
          ...line,
          excluded: draftByRow.get(line.rowNumber) ?? line.excluded,
        }))
        return {
          ...bundle,
          lines,
          excluded: lines.every((line) => line.excluded),
        }
      }),
    [bundles, draftByRow],
  )

  useEffect(() => {
    onExcludedRowNumbersChange?.(
      excludedRowNumbersFromStockHoldBundles(liveBundles),
    )
  }, [liveBundles, onExcludedRowNumbersChange])

  const productSummaries = useMemo(() => {
    const byStyle = new Map<
      string,
      ProductSummary & { bundleKeys: Set<string> }
    >()
    for (const bundle of liveBundles) {
      if (filter === 'out_of_stock') continue
      if (filter !== 'all' && !bundle.reasons.includes(filter)) continue
      for (const trigger of bundle.triggers) {
        if (filter !== 'all' && trigger.reason !== filter) continue
        let entry = byStyle.get(trigger.styleId)
        if (!entry) {
          entry = {
            styleId: trigger.styleId,
            styleNo: trigger.styleNo,
            styleName: trigger.styleName,
            reason: trigger.reason,
            detail: trigger.detail,
            bundleCount: 0,
            matchedRowCount: 0,
            affectedRowCount: 0,
            excludedRowCount: 0,
            releasedRowCount: 0,
            bundleKeys: new Set(),
          }
          byStyle.set(trigger.styleId, entry)
        }
        if (!entry.bundleKeys.has(bundle.key)) {
          entry.bundleKeys.add(bundle.key)
          entry.bundleCount += 1
          entry.affectedRowCount += bundle.affectedRowCount
        }
        for (const line of bundle.lines) {
          const hit = line.triggers.some(
            (item) => item.styleId === trigger.styleId,
          )
          if (!hit) continue
          entry.matchedRowCount += 1
          if (line.excluded) entry.excludedRowCount += 1
          else entry.releasedRowCount += 1
        }
      }
    }
    return [...byStyle.values()]
      .map(({ bundleKeys: _keys, ...item }) => item)
      .sort((left, right) => {
        const byReason =
          (left.reason === 'discontinued' ? 0 : 1) -
          (right.reason === 'discontinued' ? 0 : 1)
        if (byReason !== 0) return byReason
        return left.styleNo.localeCompare(right.styleNo, 'ko')
      })
  }, [filter, liveBundles])

  useEffect(() => {
    if (
      productStyleId &&
      !productSummaries.some((item) => item.styleId === productStyleId)
    ) {
      setProductStyleId(null)
    }
  }, [productStyleId, productSummaries])

  const counts = useMemo(() => {
    const next = {
      all: liveBundles.length,
      discontinued: 0,
      out_of_stock: 0,
      reservation: 0,
      excluded: 0,
      released: 0,
    }
    for (const bundle of liveBundles) {
      for (const reason of bundle.reasons) next[reason] += 1
      for (const line of bundle.lines) {
        if (line.excluded) next.excluded += 1
        else next.released += 1
      }
    }
    return next
  }, [liveBundles])

  const visibleBundles = useMemo(
    () =>
      liveBundles.filter((bundle) => {
        if (filter === 'out_of_stock') return false
        if (filter !== 'all' && !bundle.reasons.includes(filter)) return false
        if (
          productStyleId &&
          !bundle.triggers.some((trigger) => trigger.styleId === productStyleId)
        ) {
          return false
        }
        return true
      }),
    [filter, liveBundles, productStyleId],
  )

  const visibleLines = useMemo(
    () => visibleBundles.flatMap((bundle) => bundle.lines),
    [visibleBundles],
  )

  const allVisibleReleased =
    visibleLines.length > 0 && visibleLines.every((line) => !line.excluded)
  const someVisibleReleased = visibleLines.some((line) => !line.excluded)

  function setLineReleased(rowNumber: number, released: boolean) {
    setDraftByRow((current) => {
      const next = new Map(current)
      next.set(rowNumber, !released)
      return next
    })
  }

  function setBundleReleased(bundle: LiveBundle, released: boolean) {
    setDraftByRow((current) => {
      const next = new Map(current)
      for (const line of bundle.lines) next.set(line.rowNumber, !released)
      return next
    })
  }

  function setReleasedForVisible(released: boolean) {
    setDraftByRow((current) => {
      const next = new Map(current)
      for (const line of visibleLines) next.set(line.rowNumber, !released)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        단종·예발이 있으면 그 합포장(같은 받는분·주문일시) 행은 기본으로 모두
        출고 제외됩니다. 행마다 체크하면 부분 출고할 수 있고, 합포장 단위로도
        한 번에 풀거나 막을 수 있습니다. 재고부족 판정은 아직 연결하지
        않았습니다.
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {REASON_FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={filter === item.value}
            onClick={() => setFilter(item.value)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs',
              filter === item.value
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:bg-muted/50',
            )}
          >
            {item.label}{' '}
            <span className="tabular-nums">
              {formatNumber(
                item.value === 'all' ? counts.all : counts[item.value],
              )}
            </span>
          </button>
        ))}
        <Badge variant="outline">제외 {formatNumber(counts.excluded)}</Badge>
        <Badge variant="muted">진행 {formatNumber(counts.released)}</Badge>
      </div>

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium text-foreground">제품별</p>
          {productStyleId ? (
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setProductStyleId(null)}
            >
              전체
            </button>
          ) : null}
        </div>
        {productSummaries.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {loading
              ? '제품 목록을 준비하는 중입니다.'
              : '표시할 단종·예발 제품이 없습니다.'}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {productSummaries.map((product) => {
              const selected = productStyleId === product.styleId
              return (
                <button
                  key={product.styleId}
                  type="button"
                  aria-pressed={selected}
                  title={`${product.styleName} · ${product.detail}`}
                  onClick={() =>
                    setProductStyleId(selected ? null : product.styleId)
                  }
                  className={cn(
                    'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                    selected
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                  )}
                >
                  <Badge
                    variant={REASON_BADGE[product.reason]}
                    className="px-1.5 py-0 text-[10px]"
                  >
                    {REASON_LABEL[product.reason]}
                  </Badge>
                  <span className="font-mono font-medium text-foreground">
                    {product.styleNo}
                  </span>
                  <span className="min-w-0 truncate">{product.styleName}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatNumber(product.bundleCount)}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={visibleLines.length === 0}
          onClick={() => setReleasedForVisible(true)}
        >
          보이는 행 모두 진행
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={visibleLines.length === 0}
          onClick={() => setReleasedForVisible(false)}
        >
          보이는 행 모두 제외
        </Button>
      </div>

      <div className="max-h-[min(70vh,40rem)] overflow-auto rounded-lg border border-border">
        <table className="w-full min-w-[1280px] text-left text-xs">
          <thead className="sticky top-0 z-10 bg-muted/90">
            <tr>
              <th className="w-14 px-3 py-2 font-medium">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-primary"
                    checked={allVisibleReleased}
                    ref={(element) => {
                      if (element) {
                        element.indeterminate =
                          someVisibleReleased && !allVisibleReleased
                      }
                    }}
                    disabled={visibleLines.length === 0 || loading}
                    onChange={(event) =>
                      setReleasedForVisible(event.target.checked)
                    }
                    aria-label="보이는 행 모두 출고 진행"
                  />
                  <span className="sr-only">진행</span>
                </label>
              </th>
              <th className="px-3 py-2 font-medium">구분</th>
              <th className="px-3 py-2 font-medium">행</th>
              <th className="px-3 py-2 font-medium">받는분</th>
              <th className="px-3 py-2 font-medium">연락처</th>
              <th className="px-3 py-2 font-medium">쇼핑몰</th>
              <th className="px-3 py-2 font-medium">주문일시</th>
              <th className="px-3 py-2 font-medium">품목명</th>
              <th className="px-3 py-2 font-medium">내품명</th>
              <th className="px-3 py-2 font-medium">수량</th>
              <th className="px-3 py-2 font-medium">매칭</th>
              <th className="px-3 py-2 font-medium">상태</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={12}
                  className="px-3 py-10 text-center text-muted-foreground"
                >
                  단종·예발 기준을 불러오는 중입니다.
                </td>
              </tr>
            ) : visibleBundles.length === 0 ? (
              <tr>
                <td
                  colSpan={12}
                  className="px-3 py-10 text-center text-muted-foreground"
                >
                  {filter === 'out_of_stock'
                    ? '재고부족 판정은 아직 연결하지 않았습니다.'
                    : productStyleId
                      ? '선택한 제품에 해당하는 합포장이 없습니다.'
                      : filter === 'all'
                        ? '단종·예발에 걸린 합포장이 없습니다.'
                        : `이 필터에 해당하는 합포장이 없습니다.`}
                </td>
              </tr>
            ) : (
              visibleBundles.map((bundle, bundleIndex) => {
                const stripe = BUNDLE_STRIPE[bundleIndex % BUNDLE_STRIPE.length]!
                const lineCount = Math.max(bundle.lines.length, 1)
                const allReleased = bundle.lines.every((line) => !line.excluded)
                const someReleased = bundle.lines.some((line) => !line.excluded)
                return (
                  <Fragment key={bundle.key}>
                    {bundle.lines.map((line, lineIndex) => {
                      const isFirst = lineIndex === 0
                      const released = !line.excluded
                      return (
                        <tr
                          key={`${bundle.key}:${line.rowNumber}`}
                          className={cn(
                            'align-top',
                            stripe,
                            isFirst ? 'border-t border-border' : 'border-t-0',
                          )}
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              className="size-3.5 accent-primary"
                              checked={released}
                              onChange={(event) =>
                                setLineReleased(
                                  line.rowNumber,
                                  event.target.checked,
                                )
                              }
                              aria-label={`${line.rowNumber}행 출고 진행`}
                            />
                          </td>
                          {isFirst ? (
                            <td className="px-3 py-2" rowSpan={lineCount}>
                              <div className="space-y-1.5">
                                <div className="flex flex-wrap gap-1">
                                  {bundle.reasons.map((reason) => (
                                    <Badge
                                      key={reason}
                                      variant={REASON_BADGE[reason]}
                                    >
                                      {REASON_LABEL[reason]}
                                    </Badge>
                                  ))}
                                </div>
                                {lineCount > 1 ? (
                                  <div className="flex flex-wrap gap-1">
                                    <button
                                      type="button"
                                      className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                                      onClick={() =>
                                        setBundleReleased(bundle, true)
                                      }
                                    >
                                      합포장 전체 진행
                                    </button>
                                    <span className="text-[11px] text-muted-foreground">
                                      ·
                                    </span>
                                    <button
                                      type="button"
                                      className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                                      onClick={() =>
                                        setBundleReleased(bundle, false)
                                      }
                                    >
                                      전체 제외
                                    </button>
                                    {someReleased && !allReleased ? (
                                      <span className="text-[11px] text-warning">
                                        부분 출고
                                      </span>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            </td>
                          ) : null}
                          <td className="px-3 py-2 tabular-nums">
                            {line.rowNumber}
                          </td>
                          {isFirst ? (
                            <td
                              className="max-w-36 truncate px-3 py-2 font-medium"
                              rowSpan={lineCount}
                            >
                              {bundle.recipientName || '—'}
                            </td>
                          ) : null}
                          {isFirst ? (
                            <td
                              className="max-w-32 truncate px-3 py-2 font-mono"
                              rowSpan={lineCount}
                            >
                              {bundle.recipientPhone || '—'}
                            </td>
                          ) : null}
                          {isFirst ? (
                            <td
                              className="max-w-40 truncate px-3 py-2"
                              rowSpan={lineCount}
                            >
                              {bundle.mallName || '—'}
                            </td>
                          ) : null}
                          {isFirst ? (
                            <td
                              className="whitespace-nowrap px-3 py-2 tabular-nums"
                              rowSpan={lineCount}
                            >
                              {bundle.orderedAt || '—'}
                            </td>
                          ) : null}
                          <td className="max-w-56 px-3 py-2">
                            <div className="break-words font-medium">
                              {line.productName || '—'}
                            </div>
                          </td>
                          <td className="max-w-48 px-3 py-2 text-muted-foreground">
                            <div className="break-words">
                              {line.itemName || '—'}
                            </div>
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            {line.quantity || '—'}
                          </td>
                          <td className="max-w-56 px-3 py-2">
                            {line.matched ? (
                              <div className="space-y-1">
                                {line.triggers.map((trigger) => (
                                  <div
                                    key={trigger.styleId}
                                    className="leading-snug"
                                  >
                                    <span className="font-mono">
                                      {trigger.styleNo}
                                    </span>{' '}
                                    <span className="font-medium">
                                      {trigger.styleName}
                                    </span>
                                    <div className="truncate text-[11px] text-muted-foreground">
                                      {trigger.detail}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">
                                합포장
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {released ? (
                              <Badge variant="outline">출고 진행</Badge>
                            ) : (
                              <Badge variant="danger">출고 제외</Badge>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
