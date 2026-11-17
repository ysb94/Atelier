import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tab-overlay'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, RefreshCw, Upload } from 'lucide-react'
import { StylePicker } from '@/components/style-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import {
  adjustWarehouseStock,
  depleteWarehouseStock,
  getActiveWarehouseInventorySet,
  getWarehouseInventorySets,
  getWarehouseStockMovements,
  getWarehouseStockPositions,
  importWarehouseInventorySet,
  listStyleRefsForLookup,
  moveWarehouseStock,
  receiveWarehouseStock,
  restoreWarehouseInventorySet,
  subscribeWarehouseInventorySetChanges,
  type WarehouseInventorySetRealtimeStatus,
} from '@/lib/api'
import {
  correctWarehouseStockRow,
  getWarehouseSheetActivity,
  listWarehouseStockConditionLinks,
  saveWarehouseStockCondition,
  trySaveWarehouseStockWork,
  WAREHOUSE_STOCK_CONDITION_LABELS,
  type WarehouseStockCondition,
  type WarehouseSheetActivity,
  type WarehouseSheetDifference,
} from '@/lib/supabase/warehouse-stock'
import { useRenderWatch } from '@/lib/diagnostics'
import { startWorkflow } from '@/lib/diagnostics/workflow-trace'
import { parseFile } from '@/lib/import/parse'
import type {
  StyleRef,
  WarehouseStockPosition,
  WarehouseZone,
} from '@/lib/types'
import { cn, formatNumber, emptyList } from '@/lib/utils'
import {
  FINAL_LOCATION_MARK,
  FORCED_PRIORITY_DATE,
  WAREHOUSE_REVIEW_FLAG_LABEL,
  WAREHOUSE_STOCK_ACTION_LABEL,
  WAREHOUSE_USAGE_PRIORITY_LABEL,
  downloadWarehouseInventoryTemplate,
  formatWarehouseCount,
  formatWarehouseLocation,
  formatWarehouseReceivedOn,
  isWarehouseQuantityKnown,
  parseWarehouseLocation,
  parseWarehouseReceivedOn,
  parseWarehouseUploadRows,
  prepareWarehouseImportRows,
  summarizeWarehouseImport,
  warehousePositionQty,
  type PreparedWarehouseImportRow,
  type WarehouseImportSummary,
} from '@/lib/warehouse/stock'

type WarehouseView = 'box' | 'outbound'
type ReviewFilter =
  | 'all'
  | 'ok'
  | 'forced'
  | 'final'
  | 'review'
  | 'unknown_qty'
  | 'unlinked'
type DialogState =
  | { kind: 'import' }
  | { kind: 'receive' }
  | { kind: 'correct'; row: WarehouseStockPosition; current: WarehouseStockCondition; styleNo: string }
  | { kind: 'condition'; row: WarehouseStockPosition; current: WarehouseStockCondition; styleNo: string }
  | { kind: 'move'; row: WarehouseStockPosition }
  | { kind: 'deplete'; row: WarehouseStockPosition; requestId: string }
  | { kind: 'adjust'; row: WarehouseStockPosition }
  | { kind: 'history'; row?: WarehouseStockPosition }
  | null

const TABLE_PAGE_SIZE = 100
const SHEET_CONFLICT_LABELS: Record<string, string> = {
  SHEET_STOCK_CHANGED: '시트 값이 저장 전 값과 다릅니다.',
  SHEET_REPAIR_HISTORY_UNAVAILABLE: '자동 정정 이력을 기록하지 못했습니다. 다음 동기화에서 다시 시도합니다.',
  SHEET_VALUES_UNVERIFIED: '시트에서 최종 값을 확인하지 못했습니다.',
  REMOVAL_UNVERIFIED: '소진된 행을 확인하지 못했습니다.',
  AA_MISSING_OR_DUPLICATE: 'AA 행 ID가 중복되거나 누락됐습니다.',
  QR_AT_ANOTHER_ROW: '다른 행에 같은 박스 QR이 있습니다.',
  PICKING_OCCUPIED: '출고창고 자리에 다른 재고가 있습니다.',
  FORMULA_CELL: '변경할 셀에 수식이 있습니다.',
  NO_EMPTY_ROW: '신규 재고를 넣을 빈 입력 행이 없습니다.',
  OUTSIDE_SNAPSHOT_RANGE: '행이 창고입력 동기화 범위를 벗어났습니다.',
}

const FILTERS: { value: ReviewFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'ok', label: '정상' },
  { value: 'forced', label: '강제우선' },
  { value: 'final', label: '마지막위치' },
  { value: 'review', label: '검수필요' },
  { value: 'unknown_qty', label: '수량 미확인' },
  { value: 'unlinked', label: '상품 미연결' },
]

function formatImportedAt(value: string) {
  return new Date(value).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function uniqueStyleRefs(lookup: {
  byStyleNo: Map<string, StyleRef>
  byName: Map<string, StyleRef[]>
}): StyleRef[] {
  return Array.from(
    new Map(
      [
        ...lookup.byStyleNo.values(),
        ...[...lookup.byName.values()].flat(),
      ].map((ref) => [ref.styleId, ref]),
    ).values(),
  )
}

export function WarehouseInventoryPanel({
  brandId,
  brandName,
  sheetConditionEnabled,
  view,
}: {
  brandId: string
  brandName: string
  sheetConditionEnabled: boolean
  view: WarehouseView
}) {
  useRenderWatch('WarehouseInventoryPanel')
  const queryClient = useQueryClient()
  const tabActive = useWorkspaceTabActivity()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ReviewFilter>('all')
  const [tablePage, setTablePage] = useState(0)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [error, setError] = useState<string | null>(null)
  const [downloadingTemplate, setDownloadingTemplate] = useState(false)
  const [liveStatus, setLiveStatus] =
    useState<WarehouseInventorySetRealtimeStatus>('connecting')
  const [refreshing, setRefreshing] = useState(false)
  const zone: WarehouseZone = view === 'box' ? 'box_storage' : 'picking'
  const warehouseLabel = view === 'box' ? '박스창고' : '출고창고'
  const sheetConflicts = useQuery({
    queryKey: ['warehouse-sheet-conflicts', brandId],
    queryFn: () => getWarehouseSheetActivity(brandId),
    enabled: tabActive && sheetConditionEnabled && Boolean(brandId),
    refetchInterval: tabActive ? 30_000 : false,
  })

  async function downloadTemplate() {
    setDownloadingTemplate(true)
    setError(null)
    try {
      await downloadWarehouseInventoryTemplate(brandName, zone)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : '양식을 내려받지 못했습니다.',
      )
    } finally {
      setDownloadingTemplate(false)
    }
  }

  const setQuery = useQuery({
    queryKey: ['warehouse-inventory-set', brandId],
    queryFn: () => getActiveWarehouseInventorySet(brandId),
  })
  const activeSet = setQuery.data ?? null

  const positionsQuery = useQuery({
    queryKey: ['warehouse-stock-positions', brandId, activeSet?.id, zone],
    queryFn: () => getWarehouseStockPositions(brandId, activeSet!.id, zone),
    enabled: Boolean(activeSet?.id),
  })
  const conditionQuery = useQuery({
    queryKey: ['warehouse-stock-condition-links', brandId],
    queryFn: () => listWarehouseStockConditionLinks(brandId),
    enabled: Boolean(activeSet?.id),
  })
  const conditions = useMemo(() => new Map(
    (conditionQuery.data ?? []).map(link => [
      JSON.stringify([link.externalRowId, link.sourceProductName]), link,
    ]),
  ), [conditionQuery.data])
  const rows = positionsQuery.data ?? emptyList()
  const zoneRowCount = rows.filter((row) => row.zone === zone).length
  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('ko-KR')
    return (positionsQuery.data ?? emptyList<WarehouseStockPosition>())
      .filter((row) => row.zone === zone)
      .filter((row) => {
        const condition = conditions.get(JSON.stringify([row.externalRowId, row.sourceProductName]))
        const reviewFlags = condition ? row.reviewFlags.filter(flag => flag !== 'missing_style') : row.reviewFlags
        if (filter === 'ok') return !condition && reviewFlags.length === 0
        if (filter === 'forced') {
          return row.usagePriority === 'first' || row.usagePriority === 'second'
        }
        if (filter === 'final') return row.isFinalLocation
        if (filter === 'review') return reviewFlags.length > 0
        if (filter === 'unknown_qty') return !isWarehouseQuantityKnown(row)
        if (filter === 'unlinked') return !row.styleId && !condition
        return true
      })
      .filter((row) => {
        if (!q) return true
        const condition = conditions.get(JSON.stringify([row.externalRowId, row.sourceProductName]))
        return (
          row.styleNo.toLocaleLowerCase('ko-KR').includes(q) ||
          row.sourceStyleNo.toLocaleLowerCase('ko-KR').includes(q) ||
          condition?.referenceStyleNo.toLocaleLowerCase('ko-KR').includes(q) ||
          row.styleName.toLocaleLowerCase('ko-KR').includes(q) ||
          row.boxQr?.toLocaleLowerCase('ko-KR').includes(q) ||
          formatWarehouseLocation(row)
            .toLocaleLowerCase('ko-KR')
            .includes(q)
        )
      })
      .sort((left, right) => {
        const leftRank = left.usageRank ?? 9999
        const rightRank = right.usageRank ?? 9999
        if (leftRank !== rightRank) return leftRank - rightRank
        if (left.styleNo !== right.styleNo) {
          return left.styleNo.localeCompare(right.styleNo, 'ko-KR')
        }
        return left.sourceRowNumber - right.sourceRowNumber
      })
  }, [conditions, filter, positionsQuery.data, search, zone])

  useEffect(() => {
    setTablePage(0)
  }, [brandId, filter, search, zone])

  const tablePageCount = Math.max(1, Math.ceil(visible.length / TABLE_PAGE_SIZE))
  const currentTablePage = Math.min(tablePage, tablePageCount - 1)
  const pagedVisible = visible.slice(
    currentTablePage * TABLE_PAGE_SIZE,
    currentTablePage * TABLE_PAGE_SIZE + TABLE_PAGE_SIZE,
  )

  const invalidateStock = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['warehouse-inventory-set', brandId],
      }),
      queryClient.invalidateQueries({
        queryKey: ['warehouse-inventory-sets', brandId],
      }),
      queryClient.invalidateQueries({
        queryKey: ['warehouse-stock-positions', brandId],
      }),
      queryClient.invalidateQueries({
        queryKey: ['warehouse-stock-condition-links', brandId],
      }),
      queryClient.invalidateQueries({
        queryKey: ['warehouse-stock-movements', brandId],
      }),
      queryClient.invalidateQueries({
        queryKey: ['warehouse-sheet-conflicts', brandId],
      }),
    ])
  }, [brandId, queryClient])

  async function finishStockSave() {
    await invalidateStock()
    setDialog(null)
  }

  useEffect(() => {
    if (!tabActive || !brandId) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let seenSubscribe = false
    const scheduleRefresh = () => {
      if (timer != null) clearTimeout(timer)
      timer = setTimeout(() => {
        void invalidateStock()
      }, 400)
    }
    setLiveStatus('connecting')
    const unsubscribe = subscribeWarehouseInventorySetChanges(brandId, {
      onChange: scheduleRefresh,
      onStatus(status) {
        setLiveStatus(status)
        if (status === 'subscribed') {
          if (seenSubscribe) scheduleRefresh()
          seenSubscribe = true
        }
      },
    })
    return () => {
      if (timer != null) clearTimeout(timer)
      unsubscribe()
    }
  }, [brandId, invalidateStock, tabActive])

  async function refreshStock() {
    if (refreshing) return
    setRefreshing(true)
    setError(null)
    try {
      await invalidateStock()
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : '창고 목록을 새로고침하지 못했습니다.'
      console.warn('[warehouse] 수동 새로고침 실패', { brandId, message })
      setError(message)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="space-y-4">
      {sheetConditionEnabled && (sheetConflicts.isError ? (
        <p role="status" className="text-xs text-danger">창고입력 반영 상태를 불러오지 못했습니다.</p>
      ) : (
        <SheetActivity activity={sheetConflicts.data} />
      ))}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="warning">연습 데이터</Badge>
            {activeSet ? (
              <>
                <span className="text-sm font-medium">
                  {warehouseLabel} {formatNumber(zoneRowCount)}행
                </span>
                <span className="text-xs text-muted-foreground">
                  최근 교체 {activeSet.sourceFileName} ·{' '}
                  {formatImportedAt(activeSet.importedAt)} · 전체{' '}
                  {formatNumber(activeSet.rowCount)}행
                </span>
                <span className="text-xs text-muted-foreground">
                  {liveStatus === 'subscribed' ? '자동 갱신 중' : '재연결 중'}
                </span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">
                아직 가져온 연습 데이터가 없습니다.
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={refreshing || setQuery.isFetching || positionsQuery.isFetching}
            onClick={() => {
              void refreshStock()
            }}
          >
            <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
            {refreshing || setQuery.isFetching || positionsQuery.isFetching
              ? '새로고침 중...'
              : '새로고침'}
          </Button>
          {view === 'box' || sheetConditionEnabled ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setError(null)
                setDialog({ kind: 'receive' })
              }}
              disabled={!activeSet}
            >
              신규 입고
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={() => setDialog({ kind: 'history' })}>
            변경 이력
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={downloadingTemplate}
            onClick={() => {
              void downloadTemplate()
            }}
          >
            <Download className="size-3.5" />
            {downloadingTemplate
              ? '준비 중...'
              : `${warehouseLabel} 양식 다운로드`}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setError(null)
              setDialog({ kind: 'import' })
            }}
          >
            <Upload className="size-3.5" />
            {warehouseLabel} 엑셀 업로드
          </Button>
        </div>
      </div>

      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="M번호·상품명·자리번호·박스 QR"
          className="h-8 max-w-64"
        />
        {FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setFilter(item.value)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px]',
              filter === item.value
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:bg-muted/50',
            )}
          >
            {item.label}
          </button>
        ))}
        <span className="text-[11px] text-muted-foreground">
          {formatNumber(visible.length)} / {formatNumber(rows.filter((row) => row.zone === zone).length)}행
        </span>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border">
        <table className="min-w-[1100px] w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-primary text-primary-foreground">
            <tr className="text-left text-[10px] uppercase tracking-wide text-primary-foreground">
              <th className="border-b border-border px-2 py-2">순서</th>
              <th className="border-b border-border px-2 py-2">M번호</th>
              <th className="border-b border-border px-2 py-2">상품명</th>
              <th className="border-b border-border px-2 py-2">위치</th>
              <th className="border-b border-border px-2 py-2">박스 QR</th>
              <th className="border-b border-border px-2 py-2">입고일</th>
              <th className="border-b border-border px-2 py-2 text-right">입수</th>
              <th className="border-b border-border px-2 py-2 text-right">잔여박스</th>
              {view === 'outbound' ? (
                <th className="border-b border-border px-2 py-2 text-right">개봉낱개</th>
              ) : null}
              <th className="border-b border-border px-2 py-2 text-right">총수량</th>
              <th className="border-b border-border px-2 py-2">검수</th>
              <th className="border-b border-border px-2 py-2">관리</th>
            </tr>
          </thead>
          <tbody>
            {setQuery.isLoading || positionsQuery.isLoading ? (
              <tr>
                <td
                  colSpan={view === 'outbound' ? 12 : 11}
                  className="px-3 py-10 text-center text-muted-foreground"
                >
                  {activeSet
                    ? `${warehouseLabel} ${formatNumber(activeSet.rowCount)}행 중 해당 구역을 불러오는 중…`
                    : '불러오는 중…'}
                </td>
              </tr>
            ) : setQuery.isError || positionsQuery.isError ? (
              <tr>
                <td
                  colSpan={view === 'outbound' ? 12 : 11}
                  className="px-3 py-10 text-center text-danger"
                >
                  {(setQuery.error instanceof Error
                    ? setQuery.error.message
                    : null) ??
                    (positionsQuery.error instanceof Error
                      ? positionsQuery.error.message
                      : '창고 재고를 불러오지 못했습니다.')}
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td
                  colSpan={view === 'outbound' ? 12 : 11}
                  className="px-3 py-10 text-center text-muted-foreground"
                >
                  {activeSet
                    ? view === 'outbound'
                      ? '출고창고 재고가 없습니다. 엑셀을 올리거나 박스창고에서 충원하세요.'
                      : '조건에 맞는 자리가 없습니다.'
                    : '엑셀을 가져와 연습 데이터를 만드세요.'}
                </td>
              </tr>
            ) : (
              pagedVisible.map((row) => {
                const condition = conditions.get(JSON.stringify([row.externalRowId, row.sourceProductName]))
                const reviewFlags = condition ? row.reviewFlags.filter(flag => flag !== 'missing_style') : row.reviewFlags
                return (
                <tr
                  key={row.id}
                  className={cn(
                    'border-b border-border/70',
                    row.usageRank === 1 && 'bg-primary/5',
                    isWarehouseQuantityKnown(row) &&
                      (row.remainingBoxes ?? 0) === 0 &&
                      row.openedUnits === 0 &&
                      'text-muted-foreground',
                  )}
                >
                  <td className="px-2 py-1.5">
                    <span className="inline-flex flex-wrap items-center gap-1 tabular-nums">
                      {row.usageRank ?? '—'}
                      {row.usagePriority !== 'fifo' ? (
                        <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
                          {WAREHOUSE_USAGE_PRIORITY_LABEL[row.usagePriority]}
                        </Badge>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 font-medium tabular-nums">
                    {condition?.referenceStyleNo || row.styleNo || row.sourceStyleNo}
                  </td>
                  <td className="max-w-[220px] truncate px-2 py-1.5">
                    {row.styleName}
                    {condition && (
                      <Badge variant="warning" className="ml-1" title="판매 가능 수량에서 제외">
                        {WAREHOUSE_STOCK_CONDITION_LABELS[condition.condition]}
                      </Badge>
                    )}
                  </td>
                  <td
                    className="px-2 py-1.5"
                    title={row.isFinalLocation ? '마지막 위치' : undefined}
                  >
                    {formatWarehouseLocation(row)}
                  </td>
                  <td className="max-w-56 truncate px-2 py-1.5 font-mono" title={row.boxQr ?? undefined}>
                    {row.boxQr ?? '—'}
                  </td>
                  <td
                    className={cn(
                      'px-2 py-1.5',
                      row.isForcedPriority && 'text-muted-foreground',
                    )}
                    title={
                      row.usagePriority === 'first'
                        ? '최우선 (000000)'
                        : row.usagePriority === 'second'
                          ? '차순위 (000001)'
                          : row.usagePriority === 'last'
                            ? '마지막 (999999)'
                            : undefined
                    }
                  >
                    {formatWarehouseReceivedOn(row)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatWarehouseCount(row.unitsPerBox)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatWarehouseCount(row.remainingBoxes)}
                  </td>
                  {view === 'outbound' ? (
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatNumber(row.openedUnits)}
                    </td>
                  ) : null}
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {isWarehouseQuantityKnown(row)
                      ? formatNumber(warehousePositionQty(row))
                      : '미확인'}
                  </td>
                  <td className="px-2 py-1.5">
                    {reviewFlags.length === 0 ? (
                      <span className="text-muted-foreground">{condition ? '—' : '정상'}</span>
                    ) : (
                      <span className="text-warning">
                        {reviewFlags
                          .map((flag) => WAREHOUSE_REVIEW_FLAG_LABEL[flag])
                          .join(' · ')}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      <RowAction
                        label="이동"
                        disabled={!isWarehouseQuantityKnown(row) || warehousePositionQty(row) <= 0}
                        onClick={() => setDialog({ kind: 'move', row })}
                      />
                      {sheetConditionEnabled && row.externalRowId && (
                        <RowAction label="행 수정" disabled={conditionQuery.isPending || conditionQuery.isError}
                          onClick={() => setDialog({ kind: 'correct', row,
                            current: condition?.condition ?? 'normal', styleNo: condition?.referenceStyleNo || row.sourceStyleNo })} />
                      )}
                      {sheetConditionEnabled && <RowAction
                        label="상태 변경"
                        disabled={conditionQuery.isPending || conditionQuery.isError || (!row.styleId && !condition) ||
                          (isWarehouseQuantityKnown(row) && !row.remainingBoxes && !row.openedUnits)}
                        onClick={() => setDialog({
                          kind: 'condition',
                          row,
                          current: condition?.condition ?? 'normal',
                          styleNo: condition?.referenceStyleNo || row.styleNo,
                        })}
                      />}
                      <RowAction
                        label="소진"
                        disabled={!isWarehouseQuantityKnown(row)}
                        onClick={() => setDialog({ kind: 'deplete', row, requestId: crypto.randomUUID() })}
                      />
                      <RowAction
                        label="실사"
                        onClick={() => setDialog({ kind: 'adjust', row })}
                      />
                      <RowAction
                        label="이력"
                        onClick={() => setDialog({ kind: 'history', row })}
                      />
                    </div>
                  </td>
                </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      {visible.length > TABLE_PAGE_SIZE ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {formatNumber(currentTablePage * TABLE_PAGE_SIZE + 1)}–
            {formatNumber(
              Math.min(
                visible.length,
                currentTablePage * TABLE_PAGE_SIZE + TABLE_PAGE_SIZE,
              ),
            )}
            / {formatNumber(visible.length)}행
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={currentTablePage === 0}
              onClick={() => setTablePage((page) => Math.max(0, page - 1))}
            >
              이전
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={currentTablePage >= tablePageCount - 1}
              onClick={() =>
                setTablePage((page) => Math.min(tablePageCount - 1, page + 1))
              }
            >
              다음
            </Button>
          </div>
        </div>
      ) : null}

      {dialog?.kind === 'import' ? (
        <ImportDialog
          brandId={brandId}
          brandName={brandName}
          zone={zone}
          hasActive={Boolean(activeSet)}
          onClose={() => setDialog(null)}
          onDone={async () => {
            setDialog(null)
            await invalidateStock()
          }}
          onError={setError}
        />
      ) : null}
      {dialog?.kind === 'receive' ? (
        <ReceiveDialog
          brandId={brandId}
          sheetConditionEnabled={sheetConditionEnabled}
          zone={zone}
          warehouseLabel={warehouseLabel}
          onClose={() => setDialog(null)}
          onDone={finishStockSave}
        />
      ) : null}
      {dialog?.kind === 'correct' ? (
        <StockRowCorrectionDialog brandId={brandId} row={dialog.row} current={dialog.current} styleNo={dialog.styleNo}
          onClose={() => setDialog(null)} onDone={finishStockSave} />
      ) : null}
      {dialog?.kind === 'condition' ? (
        <StockConditionDialog
          brandId={brandId}
          row={dialog.row}
          current={dialog.current}
          styleNo={dialog.styleNo}
          onClose={() => setDialog(null)}
          onDone={finishStockSave}
        />
      ) : null}
      {dialog?.kind === 'move' ? (
        <MoveDialog
          brandId={brandId}
          row={dialog.row}
          sheetEnabled={sheetConditionEnabled}
          onClose={() => setDialog(null)}
          onDone={finishStockSave}
          onError={setError}
        />
      ) : null}
      {dialog?.kind === 'deplete' ? (
        <DepleteDialog
          body={`${dialog.row.styleNo || dialog.row.sourceProductName} ${formatWarehouseLocation(dialog.row)}의 재고를 소진 처리하고 변경 이력에 남깁니다.`}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            const trace = startWorkflow('app', 'warehouse_stock_deplete')
            const saved = sheetConditionEnabled && await trace.run('save', context =>
              trySaveWarehouseStockWork(brandId, dialog.requestId, dialog.row, 'deplete', { reason }, context))
            if (!saved) await trace.run('save_legacy', () => depleteWarehouseStock(brandId, dialog.row.id, reason))
            await finishStockSave()
            trace.done()
          }}
          onError={setError}
        />
      ) : null}
      {dialog?.kind === 'adjust' ? (
        <AdjustDialog
          brandId={brandId}
          row={dialog.row}
          sheetEnabled={sheetConditionEnabled}
          onClose={() => setDialog(null)}
          onDone={finishStockSave}
          onError={setError}
        />
      ) : null}
      {dialog?.kind === 'history' ? (
        <HistoryDialog
          brandId={brandId}
          setId={dialog.row ? activeSet?.id : undefined}
          row={dialog.row}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  )
}

function RowAction({
  label,
  onClick,
  disabled,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function Overlay({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  return (
    <WorkspaceTabOverlay>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="닫기"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative z-10 max-h-[min(90vh,800px)] w-full overflow-y-auto rounded-xl border border-border bg-card shadow-xl',
          wide ? 'max-w-3xl' : 'max-w-lg',
        )}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            닫기
          </Button>
        </div>
        <div className="space-y-4 p-5">{children}</div>
      </div>
    </div>
    </WorkspaceTabOverlay>
  )
}

function ImportDialog({
  brandId,
  brandName,
  zone,
  hasActive,
  onClose,
  onDone,
  onError,
}: {
  brandId: string
  brandName: string
  zone: WarehouseZone
  hasActive: boolean
  onClose: () => void
  onDone: () => Promise<void>
  onError: (message: string | null) => void
}) {
  const [prepared, setPrepared] = useState<PreparedWarehouseImportRow[] | null>(
    null,
  )
  const [fileName, setFileName] = useState('')
  const [summary, setSummary] = useState<WarehouseImportSummary | null>(null)
  const [parsing, setParsing] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const warehouseLabel = zone === 'picking' ? '출고창고' : '박스창고'

  const setsQuery = useQuery({
    queryKey: ['warehouse-inventory-sets', brandId],
    queryFn: () => getWarehouseInventorySets(brandId),
  })
  const archived = (setsQuery.data ?? []).filter(
    (set) => set.status === 'archived',
  )

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!prepared || !fileName) throw new Error('파일을 먼저 검수하세요.')
      return importWarehouseInventorySet(brandId, fileName, prepared, zone)
    },
    onSuccess: async () => {
      onError(null)
      await onDone()
    },
    onError: (err) => {
      const message =
        err instanceof Error ? err.message : '가져오기에 실패했습니다.'
      setLocalError(message)
      onError(message)
    },
  })

  const restoreMutation = useMutation({
    mutationFn: (setId: string) => restoreWarehouseInventorySet(brandId, setId),
    onSuccess: async () => {
      onError(null)
      await onDone()
    },
    onError: (err) => {
      const message =
        err instanceof Error ? err.message : '복원에 실패했습니다.'
      setLocalError(message)
      onError(message)
    },
  })

  async function handleFile(file: File) {
    setLocalError(null)
    setParsing(true)
    try {
      const sheets = await parseFile(file)
      const parsed = parseWarehouseUploadRows(sheets)
      const styleNos = [
        ...new Set(
          parsed.map((row) => row.normalizedStyleNo).filter(Boolean),
        ),
      ]
      const names = [
        ...new Set(
          parsed
            .filter((row) => !row.normalizedStyleNo)
            .map((row) => row.sourceProductName)
            .filter(Boolean),
        ),
      ]
      const lookup = await listStyleRefsForLookup(brandId, { styleNos, names })
      const rows = prepareWarehouseImportRows(parsed, uniqueStyleRefs(lookup))
      setPrepared(rows)
      setSummary(summarizeWarehouseImport(rows))
      setFileName(file.name)
    } catch (reason) {
      setPrepared(null)
      setSummary(null)
      setLocalError(
        reason instanceof Error ? reason.message : '엑셀을 읽지 못했습니다.',
      )
    } finally {
      setParsing(false)
    }
  }

  return (
    <Overlay title={`${warehouseLabel} 엑셀 교체`} onClose={onClose} wide>
      <p className="text-xs text-muted-foreground">
        {hasActive
          ? `${warehouseLabel}만 새 엑셀로 교체하고 다른 창고는 그대로 유지합니다. 교체 전 전체 세트와 작업 이력은 삭제하지 않고 보관합니다.`
          : `양식을 내려받아 예시대로 채운 뒤 올리면 ${warehouseLabel} 연습 데이터로 가져옵니다.`}{' '}
        시트 이름 `상품업로드`와 첫 줄 헤더는 그대로 두세요. 예시 행은 지우고
        실제 재고를 넣으면 됩니다.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="text-xs font-medium">1. 예시 양식 받기</p>
          <p className="text-[11px] text-muted-foreground">
            처음 작성한다면 예시 3행과 작성안내가 든 양식부터 받으세요.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={downloading || parsing || importMutation.isPending}
            onClick={async () => {
              setDownloading(true)
              setLocalError(null)
              try {
                await downloadWarehouseInventoryTemplate(brandName, zone)
              } catch (reason) {
                setLocalError(
                  reason instanceof Error
                    ? reason.message
                    : '양식을 내려받지 못했습니다.',
                )
              } finally {
                setDownloading(false)
              }
            }}
          >
            <Download className="size-3.5" />
            {downloading ? '준비 중...' : '예시 양식 다운로드'}
          </Button>
        </div>

        <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <p className="text-xs font-medium">2. 작성한 엑셀 올리기</p>
          <p className="text-[11px] text-muted-foreground">
            실제 {warehouseLabel} 재고를 채운 XLSX를 선택하면 먼저 내용을
            검수합니다.
          </p>
          <Button
            type="button"
            size="sm"
            disabled={parsing || importMutation.isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="size-3.5" />
            {parsing ? '엑셀 확인 중...' : '엑셀 파일 선택'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv"
            className="hidden"
            disabled={parsing || importMutation.isPending}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void handleFile(file)
            }}
          />
          {fileName ? (
            <p className="break-all text-[11px] text-muted-foreground">
              선택한 파일: <span className="font-medium text-foreground">{fileName}</span>
            </p>
          ) : null}
        </div>
      </div>
      {summary ? (
        <div className="grid gap-2 text-xs sm:grid-cols-5">
          <Count label="전체" value={summary.total} />
          <Count label="정상" value={summary.ok} />
          <Count label="상품 미연결" value={summary.missingStyle} />
          <Count label="날짜 검수" value={summary.dateReview} />
          <Count label="중복 의심" value={summary.duplicateSuspect} />
          <Count label="수량 미확인" value={summary.quantityUnknown} />
        </div>
      ) : null}
      {localError ? <p className="text-xs text-danger">{localError}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          취소
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!prepared || importMutation.isPending || parsing}
          onClick={() => importMutation.mutate()}
        >
          {importMutation.isPending
            ? '가져오는 중…'
            : `${warehouseLabel}만 교체`}
        </Button>
      </div>
      {archived.length > 0 ? (
        <div className="space-y-2 border-t border-border pt-4">
          <div>
            <p className="text-xs font-medium">보관한 이전 전체 세트</p>
            <p className="text-[11px] text-muted-foreground">
              복원하면 박스창고와 출고창고가 모두 당시 상태로 돌아갑니다.
            </p>
          </div>
          {archived.map((set) => (
            <div
              key={set.id}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span>
                {set.sourceFileName} · {formatImportedAt(set.importedAt)} ·{' '}
                {formatNumber(set.rowCount)}행
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={restoreMutation.isPending}
                onClick={() => restoreMutation.mutate(set.id)}
              >
                전체 세트 복원
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </Overlay>
  )
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border px-2 py-1.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="font-medium tabular-nums">{formatNumber(value)}</p>
    </div>
  )
}

function StockConditionField({
  value,
  onChange,
  disabled,
}: {
  value: WarehouseStockCondition
  onChange: (condition: WarehouseStockCondition) => void
  disabled?: boolean
}) {
  return (
    <label className="block space-y-1 text-xs">
      <span className="text-muted-foreground">재고 상태</span>
      <Select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as WarehouseStockCondition)}
      >
        {Object.entries(WAREHOUSE_STOCK_CONDITION_LABELS).map(([condition, label]) => (
          <option key={condition} value={condition}>{label}</option>
        ))}
      </Select>
    </label>
  )
}

function StockConditionDialog({
  brandId, row, current, styleNo, onClose, onDone,
}: {
  brandId: string
  row: WarehouseStockPosition
  current: WarehouseStockCondition
  styleNo: string
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [condition, setCondition] = useState(current)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const mutation = useMutation({
    mutationFn: () => saveWarehouseStockCondition(brandId, requestId, condition, {
      positionId: row.id,
      expectedCondition: current,
    }),
    onSuccess: onDone,
  })
  return (
    <Overlay title="재고 상태 변경" onClose={onClose}>
      <p className="text-sm">{styleNo} {row.sourceProductName} · {formatWarehouseLocation(row)}</p>
      <StockConditionField value={condition} onChange={(value) => {
        setCondition(value)
        setRequestId(crypto.randomUUID())
        mutation.reset()
      }} disabled={mutation.isPending} />
      <p className="text-xs text-muted-foreground">
        {condition === 'normal' ? '판매 가능 재고로 복원됩니다.' : '판매 가능 재고에서 제외됩니다.'}
      </p>
      {mutation.error && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" disabled={mutation.isPending} onClick={onClose}>취소</Button>
        <Button type="button" size="sm" disabled={condition === current || mutation.isPending}
          onClick={() => mutation.mutate()}>저장</Button>
      </div>
    </Overlay>
  )
}

const STOCK_ROW_EDIT_FIELDS = [
  { key: 'number', label: 'M번호', max: 80 },
  { key: 'productName', label: '상품명', max: 300 },
  { key: 'place', label: '자리번호 (마지막 위치는 //)', max: 80 },
  { key: 'receivedOn', label: '입고일', max: 40 },
  { key: 'units', label: '박스당 수량', max: 6 },
  { key: 'boxes', label: '잔여 박스', max: 5 },
  { key: 'note', label: '메모', max: 500 },
] as const

function StockRowCorrectionDialog({ brandId, row, current, styleNo, onClose, onDone }: {
  brandId: string
  row: WarehouseStockPosition
  current: WarehouseStockCondition
  styleNo: string
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [requestId] = useState(() => crypto.randomUUID())
  const suffix = `_(${WAREHOUSE_STOCK_CONDITION_LABELS[current]})`
  const original = {
    number: styleNo,
    productName: current !== 'normal' && row.sourceProductName.endsWith(suffix)
      ? row.sourceProductName.slice(0, -suffix.length) : row.sourceProductName,
    place: formatWarehouseLocation(row),
    receivedOn: row.receivedOnRaw,
    units: row.unitsPerBox?.toString() ?? '',
    boxes: row.remainingBoxes?.toString() ?? '',
    note: row.note,
    zone: row.zone,
    condition: current,
  }
  const [fields, setFields] = useState(original)
  const changes = Object.fromEntries(Object.entries(fields).filter(([key, value]) =>
    value.trim() !== original[key as keyof typeof original].trim()).map(([key, value]) => [key, value.trim()]))
  const mutation = useMutation({
    mutationFn: async () => {
      const trace = startWorkflow('app', 'warehouse_row_correction')
      trace.step('validate_input')
      const patch: Record<string, string | null> = { ...changes }
      if ('receivedOn' in patch) {
        const date = parseWarehouseReceivedOn(fields.receivedOn)
        if (!date.dateValid) {
          trace.block('invalid_date')
          throw new Error('입고일을 YYMMDD 또는 YYYY-MM-DD 형식으로 입력하세요.')
        }
        patch.receivedOn = date.receivedOnRaw
        patch.date = date.receivedOn
        patch.priority = date.usagePriority
      }
      await trace.run('save', context => correctWarehouseStockRow(brandId, requestId, row, patch, context))
      return trace
    },
    onSuccess: async trace => {
      await trace.run('refresh_queries', onDone, { writeOutcome: 'committed' })
      trace.done({ writeOutcome: 'committed' })
    },
  })
  return (
    <Overlay title="재고 행 수정" onClose={onClose}>
      {row.boxQr && <p className="text-xs text-muted-foreground">박스 QR {row.boxQr}</p>}
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">창고 구역</span>
          <Select value={fields.zone} disabled={mutation.isPending}
            onChange={event => setFields({ ...fields, zone: event.target.value as WarehouseZone })}>
            <option value="box_storage">박스창고</option><option value="picking">출고창고</option>
          </Select>
        </label>
        <StockConditionField value={fields.condition} disabled={mutation.isPending}
          onChange={condition => setFields({ ...fields, condition })} />
        {STOCK_ROW_EDIT_FIELDS.map(field => (
          <label key={field.key} className={cn('space-y-1 text-xs', field.key === 'note' && 'col-span-2')}>
            <span className="text-muted-foreground">{field.label}</span>
            <Input value={fields[field.key]} maxLength={field.max} disabled={mutation.isPending}
              onChange={event => setFields({ ...fields, [field.key]: event.target.value })} />
          </label>
        ))}
      </div>
      {mutation.error && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>취소</Button>
        <Button type="button" size="sm" disabled={mutation.isPending || !Object.keys(changes).length || !fields.productName.trim()}
          onClick={() => mutation.mutate()}>수정 저장</Button>
      </div>
    </Overlay>
  )
}

function ReceiveDialog({
  brandId,
  sheetConditionEnabled,
  zone,
  warehouseLabel,
  onClose,
  onDone,
}: {
  brandId: string
  sheetConditionEnabled: boolean
  zone: WarehouseZone
  warehouseLabel: string
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [style, setStyle] = useState<StyleRef | null>(null)
  const [manualProduct, setManualProduct] = useState(false)
  const [productName, setProductName] = useState('')
  const [condition, setCondition] = useState<WarehouseStockCondition>('normal')
  const [requestId] = useState(() => crypto.randomUUID())
  const [locationRaw, setLocationRaw] = useState('')
  const [receivedRaw, setReceivedRaw] = useState('')
  const [forced, setForced] = useState(false)
  const [units, setUnits] = useState('20')
  const [boxes, setBoxes] = useState('1')
  const selectedStyle = manualProduct ? null : style
  const sourceProductName = manualProduct ? productName.trim() : selectedStyle?.name ?? ''
  const mutation = useMutation({
    mutationFn: async () => {
      const trace = startWorkflow('app', 'warehouse_receive')
      trace.step('validate_input')
      const location = parseWarehouseLocation(locationRaw)
      const received = forced
        ? parseWarehouseReceivedOn(FORCED_PRIORITY_DATE)
        : parseWarehouseReceivedOn(receivedRaw)
      const unitsPerBox = Number(units)
      const remainingBoxes = Number(boxes)
      let validationError = ''
      if (!location.locationCode) validationError = '자리번호를 입력하세요.'
      else if (!Number.isInteger(unitsPerBox) || unitsPerBox < 1) validationError = '박스당 수량을 확인하세요.'
      else if (!Number.isInteger(remainingBoxes) || remainingBoxes < 1) validationError = '박스 수를 확인하세요.'
      else if (sheetConditionEnabled && !sourceProductName) validationError = '상품을 선택하거나 상품명을 입력하세요.'
      if (validationError) {
        trace.block('invalid_input')
        throw new Error(validationError)
      }
      const receive = {
        styleId: selectedStyle?.styleId ?? null,
        sourceStyleNo: selectedStyle?.styleNo ?? '',
        sourceProductName,
        locationCode: location.locationCode,
        zone,
        isFinalLocation: location.isFinalLocation,
        receivedOn: received.receivedOn,
        receivedOnRaw: received.receivedOnRaw,
        isForcedPriority: received.isForcedPriority,
        unitsPerBox,
        remainingBoxes,
      }
      await trace.run('save', (context) => sheetConditionEnabled
        ? saveWarehouseStockCondition(brandId, requestId, manualProduct ? 'normal' : condition, { receive }, context)
        : receiveWarehouseStock(brandId, receive))
      return trace
    },
    onSuccess: async (trace) => {
      await trace.run('refresh_queries', onDone, { writeOutcome: 'committed' })
      trace.done({ writeOutcome: 'committed' })
    },
  })

  return (
    <Overlay title={`${warehouseLabel} 신규 입고`} onClose={onClose}>
      {manualProduct ? (
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">상품명</span>
          <Input value={productName} maxLength={300} onChange={(event) => setProductName(event.target.value)} />
        </label>
      ) : (
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">상품</span>
          <StylePicker brandId={brandId} value={style} onChange={setStyle} />
        </label>
      )}
      {sheetConditionEnabled && (
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={manualProduct} disabled={mutation.isPending}
            onChange={(event) => setManualProduct(event.target.checked)} />
          상품명 직접 입력 (M번호 없음)
        </label>
      )}
      {sheetConditionEnabled && !manualProduct && <StockConditionField value={condition} onChange={setCondition} disabled={mutation.isPending} />}
      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">
          자리번호 (`{FINAL_LOCATION_MARK}`이면 마지막 위치)
        </span>
        <Input value={locationRaw} maxLength={80} onChange={(e) => setLocationRaw(e.target.value)} />
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={forced}
          onChange={(event) => setForced(event.target.checked)}
        />
        강제 우선 (000000)
      </label>
      {forced ? null : (
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">입고일</span>
          <Input
            value={receivedRaw}
            maxLength={40}
            onChange={(e) => setReceivedRaw(e.target.value)}
            placeholder="YYMMDD 또는 YYYY-MM-DD"
          />
        </label>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">박스당 수량</span>
          <Input value={units} onChange={(e) => setUnits(e.target.value)} />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">박스 수</span>
          <Input value={boxes} onChange={(e) => setBoxes(e.target.value)} />
        </label>
      </div>
      {mutation.error && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          취소
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={(sheetConditionEnabled && !sourceProductName) || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          입고
        </Button>
      </div>
    </Overlay>
  )
}

function MoveDialog({
  brandId,
  row,
  sheetEnabled,
  onClose,
  onDone,
  onError,
}: {
  brandId: string
  row: WarehouseStockPosition
  sheetEnabled: boolean
  onClose: () => void
  onDone: () => Promise<void>
  onError: (message: string | null) => void
}) {
  const [toCode, setToCode] = useState('')
  const [toZone, setToZone] = useState<WarehouseZone>(row.zone)
  const [boxCount, setBoxCount] = useState(String(row.remainingBoxes ?? ''))
  const [requestId] = useState(() => crypto.randomUUID())
  const [needsDestinationZone, setNeedsDestinationZone] = useState(false)
  const useSheetMove = sheetEnabled && !needsDestinationZone
  const mutation = useMutation({
    mutationFn: async () => {
      const count = Number(boxCount)
      if (!toCode.trim()) throw new Error('옮길 자리번호를 입력하세요.')
      if (!boxCount.trim() || !Number.isInteger(count) || count < (useSheetMove ? 0 : 1) || count > (row.remainingBoxes ?? 0)) {
        throw new Error('옮길 박스 수를 확인하세요.')
      }
      const trace = startWorkflow('app', 'warehouse_stock_move')
      if (useSheetMove) {
        const saved = await trace.run('save', context => trySaveWarehouseStockWork(brandId, requestId, row, 'move', {
          to_location_code: toCode.trim(),
          box_count: count,
        }, context))
        trace.done()
        if (!saved) setNeedsDestinationZone(true)
        return saved
      }
      await trace.run('save_legacy', () => moveWarehouseStock(
        brandId,
        {
          positionId: row.id,
          toLocationCode: toCode.trim(),
          toZone,
          boxCount: count,
        },
        row.zone === 'box_storage' && toZone === 'picking' ? 'replenish' : 'move',
      ))
      trace.done()
      return true
    },
    onSuccess: async (saved) => {
      if (!saved) return
      onError(null)
      await onDone()
    },
    onError: (err) => {
      onError(err instanceof Error ? err.message : '이동에 실패했습니다.')
    },
  })

  return (
    <Overlay title="자리 이동" onClose={onClose}>
      <p className="text-xs text-muted-foreground">
        {row.styleNo} · {formatWarehouseLocation(row)} · 잔여{' '}
        {formatWarehouseCount(row.remainingBoxes)}박스.
        일부만 옮기면 원래 입고일을 유지한 새 행으로 나눕니다.
      </p>
      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">도착 자리번호</span>
        <Input value={toCode} onChange={(e) => setToCode(e.target.value)} />
      </label>
      {needsDestinationZone && (
        <p role="status" className="text-xs text-muted-foreground">도착 창고를 선택한 뒤 이동을 눌러 주세요.</p>
      )}
      {!useSheetMove && <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">도착 창고</span>
        <Select value={toZone} onChange={(e) => setToZone(e.target.value as WarehouseZone)}>
          <option value="box_storage">박스창고</option>
          <option value="picking">출고창고</option>
        </Select>
      </label>}
      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">옮길 박스 수</span>
        <Input type="number" min={row.openedUnits > 0 && row.remainingBoxes === 0 && useSheetMove ? 0 : 1}
          max={row.remainingBoxes ?? undefined} step={1} value={boxCount} onChange={(e) => setBoxCount(e.target.value)} />
      </label>
      {mutation.error && <p role="alert" className="text-xs text-danger">{mutation.error.message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          취소
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={
            mutation.isPending ||
            !isWarehouseQuantityKnown(row) ||
            (!useSheetMove && (row.remainingBoxes ?? 0) < 1)
          }
          onClick={() => mutation.mutate()}
        >
          이동
        </Button>
      </div>
    </Overlay>
  )
}

function AdjustDialog({
  brandId,
  row,
  sheetEnabled,
  onClose,
  onDone,
  onError,
}: {
  brandId: string
  row: WarehouseStockPosition
  sheetEnabled: boolean
  onClose: () => void
  onDone: () => Promise<void>
  onError: (message: string | null) => void
}) {
  const [boxes, setBoxes] = useState(String(row.remainingBoxes ?? ''))
  const [units, setUnits] = useState(String(row.unitsPerBox ?? ''))
  const [opened, setOpened] = useState(String(row.openedUnits))
  const [requestId] = useState(() => crypto.randomUUID())
  const mutation = useMutation({
    mutationFn: async () => {
      if ([boxes, units, opened].some(value => !value.trim())) throw new Error('입수와 잔여 수량을 입력하세요.')
      const trace = startWorkflow('app', 'warehouse_stock_adjust')
      const saved = sheetEnabled && await trace.run('save', context => trySaveWarehouseStockWork(brandId, requestId, row, 'adjust', {
        remaining_boxes: Number(boxes),
        opened_units: Number(opened),
        units_per_box: Number(units),
      }, context))
      if (!saved) {
        await trace.run('save_legacy', () => adjustWarehouseStock(brandId, {
          positionId: row.id,
          remainingBoxes: Number(boxes),
          openedUnits: Number(opened),
          unitsPerBox: Number(units),
        }))
      }
      trace.done()
    },
    onSuccess: async () => {
      onError(null)
      await onDone()
    },
    onError: (err) => {
      onError(err instanceof Error ? err.message : '실사 수정에 실패했습니다.')
    },
  })

  return (
    <Overlay title="실사 수정" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">박스당 수량</span>
          <Input value={units} onChange={(e) => setUnits(e.target.value)} />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">잔여 박스</span>
          <Input value={boxes} onChange={(e) => setBoxes(e.target.value)} />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">개봉 낱개</span>
          <Input value={opened} onChange={(e) => setOpened(e.target.value)} />
        </label>
      </div>
      {mutation.error && <p role="alert" className="text-xs text-danger">{mutation.error.message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          취소
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          저장
        </Button>
      </div>
    </Overlay>
  )
}

function SheetDifferences({ differences, completed = false }: {
  differences: WarehouseSheetDifference[]
  completed?: boolean
}) {
  if (!differences.length) return null
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr><th>행</th><th>항목</th><th>기대 시트값</th><th>{completed ? '정정 전 시트값' : '실제 시트값'}</th><th>{completed ? '반영된 값' : '반영할 값'}</th></tr>
        </thead>
        <tbody>
          {differences.map((difference, index) => (
            <tr key={index} className="border-t border-border">
              {[difference.id, difference.field, difference.expected, difference.actual,
                completed && difference.target === null ? '삭제' : difference.target]
                .map((value, column) => <td key={column} className="p-1.5">{value === '' ? '비어 있음' : value ?? '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SheetActivity({ activity }: { activity?: WarehouseSheetActivity }) {
  if (!activity) return null
  const { conflicts, repairs } = activity
  return (
    <>
      {conflicts.length > 0 && (
        <section aria-label="창고입력 반영 확인" className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
          <p className="font-medium">창고입력 반영 확인 필요 · {conflicts.length}건</p>
          {conflicts.map(({ id, row_ids: rowIds, failed_at: failedAt, failure }) => (
            <details key={id} className="mt-2">
              <summary className="cursor-pointer text-xs">
                {SHEET_CONFLICT_LABELS[failure.reason] ?? '다음 동기화에서 다시 확인합니다.'} {formatImportedAt(failedAt)}
              </summary>
              <p className="my-2 break-all text-xs text-muted-foreground">AA {rowIds.join(', ')}</p>
              <SheetDifferences differences={failure.differences} />
            </details>
          ))}
        </section>
      )}
      {repairs.length > 0 && (
        <details className="rounded-md border border-border bg-card p-3 text-sm">
          <summary className="cursor-pointer font-medium">창고입력 자동 정정 완료 · 최근 {repairs.length}건</summary>
          {repairs.map(repair => (
            <details key={repair.id} className="mt-2">
              <summary className="cursor-pointer text-xs">Atelier 재고 기준으로 반영 완료 · {formatImportedAt(repair.completed_at)}</summary>
              <p className="my-2 break-all text-xs text-muted-foreground">AA {repair.row_ids.join(', ')}</p>
              <SheetDifferences differences={repair.repair_differences} completed />
            </details>
          ))}
        </details>
      )}
    </>
  )
}

function DepleteDialog({
  body,
  onClose,
  onConfirm,
  onError,
}: {
  body: string
  onClose: () => void
  onConfirm: (reason: string) => Promise<void>
  onError: (message: string | null) => void
}) {
  const [reason, setReason] = useState('')
  const mutation = useMutation({
    mutationFn: onConfirm,
    onError: (err) => {
      onError(err instanceof Error ? err.message : '작업에 실패했습니다.')
    },
  })
  return (
    <Overlay title="자리 소진" onClose={onClose}>
      <p className="text-xs text-muted-foreground">{body}</p>
      <label className="block space-y-1 text-xs">
        <span>소진 사유 (선택)</span>
        <Input value={reason} maxLength={500} disabled={mutation.isPending} onChange={event => setReason(event.target.value)} />
      </label>
      {mutation.error && <p role="alert" className="text-xs text-danger">{mutation.error.message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          취소
        </Button>
        <Button
          type="button"
          size="sm"
          variant="danger"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate(reason.trim() || '자리 소진')}
        >
          소진
        </Button>
      </div>
    </Overlay>
  )
}

function HistoryDialog({
  brandId,
  setId,
  row,
  onClose,
}: {
  brandId: string
  setId?: string
  row?: WarehouseStockPosition
  onClose: () => void
}) {
  const query = useQuery({
    queryKey: ['warehouse-stock-movements', brandId, setId, row?.id],
    queryFn: () => getWarehouseStockMovements(brandId, setId, row?.id),
    enabled: !row || Boolean(setId),
  })
  const movements = query.data ?? emptyList()

  return (
    <Overlay title={row ? `${row.styleNo} 이력` : '변경 이력'} onClose={onClose} wide>
      {query.isLoading ? (
        <p className="text-xs text-muted-foreground">불러오는 중…</p>
      ) : movements.length === 0 ? (
        <p className="text-xs text-muted-foreground">이력이 없습니다.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="pb-2">시각</th>
              <th className="pb-2">작업</th>
              <th className="pb-2">출발</th>
              <th className="pb-2">도착</th>
              <th className="pb-2 text-right">박스</th>
              <th className="pb-2">사유</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((item) => (
              <tr key={item.id} className="border-t border-border/70">
                <td className="py-1.5">{formatImportedAt(item.createdAt)}</td>
                <td className="py-1.5">
                  {WAREHOUSE_STOCK_ACTION_LABEL[item.action]}
                </td>
                <td className="py-1.5">{item.fromLocationCode ?? '—'}</td>
                <td className="py-1.5">{item.toLocationCode ?? '—'}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {formatNumber(item.boxCount)}
                </td>
                <td className="py-1.5">{item.reason || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Overlay>
  )
}
