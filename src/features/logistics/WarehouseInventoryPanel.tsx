import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tabs'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { StylePicker } from '@/components/style-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  openWarehouseStock,
  receiveWarehouseStock,
  restoreWarehouseInventorySet,
} from '@/lib/api'
import { parseFile } from '@/lib/import/parse'
import type {
  StyleRef,
  WarehouseStockPosition,
  WarehouseZone,
} from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'
import {
  FINAL_LOCATION_MARK,
  FORCED_PRIORITY_DATE,
  WAREHOUSE_REVIEW_FLAG_LABEL,
  WAREHOUSE_STOCK_ACTION_LABEL,
  downloadWarehouseInventoryTemplate,
  formatWarehouseLocation,
  formatWarehouseReceivedOn,
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
type ReviewFilter = 'all' | 'ok' | 'forced' | 'final' | 'review'
type DialogState =
  | { kind: 'import' }
  | { kind: 'receive' }
  | { kind: 'move'; row: WarehouseStockPosition }
  | { kind: 'replenish'; row: WarehouseStockPosition }
  | { kind: 'deplete'; row: WarehouseStockPosition }
  | { kind: 'adjust'; row: WarehouseStockPosition }
  | { kind: 'open'; row: WarehouseStockPosition }
  | { kind: 'history'; row?: WarehouseStockPosition }
  | null

const TABLE_PAGE_SIZE = 100

const FILTERS: { value: ReviewFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'ok', label: '정상' },
  { value: 'forced', label: '강제우선' },
  { value: 'final', label: '마지막위치' },
  { value: 'review', label: '검수필요' },
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
  view,
}: {
  brandId: string
  brandName: string
  view: WarehouseView
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ReviewFilter>('all')
  const [tablePage, setTablePage] = useState(0)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [error, setError] = useState<string | null>(null)
  const [downloadingTemplate, setDownloadingTemplate] = useState(false)
  const zone: WarehouseZone = view === 'box' ? 'box_storage' : 'picking'
  const warehouseLabel = view === 'box' ? '박스창고' : '출고창고'

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

  const rows = positionsQuery.data ?? []
  const zoneRowCount = rows.filter((row) => row.zone === zone).length
  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('ko-KR')
    return (positionsQuery.data ?? [])
      .filter((row) => row.zone === zone)
      .filter((row) => {
        if (filter === 'ok') return row.reviewFlags.length === 0
        if (filter === 'forced') return row.isForcedPriority
        if (filter === 'final') return row.isFinalLocation
        if (filter === 'review') return row.reviewFlags.length > 0
        return true
      })
      .filter((row) => {
        if (!q) return true
        return (
          row.styleNo.toLocaleLowerCase('ko-KR').includes(q) ||
          row.styleName.toLocaleLowerCase('ko-KR').includes(q) ||
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
  }, [filter, positionsQuery.data, search, zone])

  useEffect(() => {
    setTablePage(0)
  }, [brandId, filter, search, zone])

  const tablePageCount = Math.max(1, Math.ceil(visible.length / TABLE_PAGE_SIZE))
  const currentTablePage = Math.min(tablePage, tablePageCount - 1)
  const pagedVisible = visible.slice(
    currentTablePage * TABLE_PAGE_SIZE,
    currentTablePage * TABLE_PAGE_SIZE + TABLE_PAGE_SIZE,
  )

  async function invalidateStock() {
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
        queryKey: ['warehouse-stock-movements', brandId],
      }),
    ])
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
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
              </>
            ) : (
              <span className="text-sm text-muted-foreground">
                아직 가져온 연습 데이터가 없습니다.
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            엑셀이 원본입니다. 사이트 숫자는 송장 예약·실재고와 연결하지 않습니다.
            사용 순서는 강제우선 → 입고일 → 마지막 위치입니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {view === 'box' ? (
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
          placeholder="M번호·상품명·자리번호"
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
          <thead className="sticky top-0 z-10 bg-muted/90">
            <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="border-b border-border px-2 py-2">순서</th>
              <th className="border-b border-border px-2 py-2">M번호</th>
              <th className="border-b border-border px-2 py-2">상품명</th>
              <th className="border-b border-border px-2 py-2">위치</th>
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
                  colSpan={view === 'outbound' ? 11 : 10}
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
                  colSpan={view === 'outbound' ? 11 : 10}
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
                  colSpan={view === 'outbound' ? 11 : 10}
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
              pagedVisible.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    'border-b border-border/70',
                    row.usageRank === 1 && 'bg-primary/5',
                    row.remainingBoxes === 0 &&
                      row.openedUnits === 0 &&
                      'text-muted-foreground',
                  )}
                >
                  <td className="px-2 py-1.5">
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      {row.usageRank ?? '—'}
                      {row.isForcedPriority ? (
                        <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
                          우선
                        </Badge>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 font-medium tabular-nums">
                    {row.styleNo || row.sourceStyleNo}
                  </td>
                  <td className="max-w-[220px] truncate px-2 py-1.5">
                    {row.styleName}
                  </td>
                  <td
                    className="px-2 py-1.5"
                    title={row.isFinalLocation ? '마지막 위치' : undefined}
                  >
                    {formatWarehouseLocation(row)}
                  </td>
                  <td
                    className={cn(
                      'px-2 py-1.5',
                      row.isForcedPriority && 'text-muted-foreground',
                    )}
                    title={
                      row.isForcedPriority ? '강제우선 (000000)' : undefined
                    }
                  >
                    {formatWarehouseReceivedOn(row)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatNumber(row.unitsPerBox)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatNumber(row.remainingBoxes)}
                  </td>
                  {view === 'outbound' ? (
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatNumber(row.openedUnits)}
                    </td>
                  ) : null}
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatNumber(warehousePositionQty(row))}
                  </td>
                  <td className="px-2 py-1.5">
                    {row.reviewFlags.length === 0 ? (
                      <span className="text-muted-foreground">정상</span>
                    ) : (
                      <span className="text-warning">
                        {row.reviewFlags
                          .map((flag) => WAREHOUSE_REVIEW_FLAG_LABEL[flag])
                          .join(' · ')}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {view === 'box' ? (
                        <>
                          <RowAction
                            label="이동"
                            onClick={() => setDialog({ kind: 'move', row })}
                          />
                          <RowAction
                            label="충원"
                            onClick={() => setDialog({ kind: 'replenish', row })}
                          />
                        </>
                      ) : (
                        <RowAction
                          label="개봉"
                          onClick={() => setDialog({ kind: 'open', row })}
                        />
                      )}
                      <RowAction
                        label="소진"
                        onClick={() => setDialog({ kind: 'deplete', row })}
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
              ))
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
          onClose={() => setDialog(null)}
          onDone={async () => {
            setDialog(null)
            await invalidateStock()
          }}
          onError={setError}
        />
      ) : null}
      {dialog?.kind === 'move' || dialog?.kind === 'replenish' ? (
        <MoveDialog
          brandId={brandId}
          row={dialog.row}
          replenish={dialog.kind === 'replenish'}
          onClose={() => setDialog(null)}
          onDone={async () => {
            setDialog(null)
            await invalidateStock()
          }}
          onError={setError}
        />
      ) : null}
      {dialog?.kind === 'deplete' ? (
        <ConfirmDialog
          title="자리 소진"
          body={`${dialog.row.styleNo} ${formatWarehouseLocation(dialog.row)}의 잔여 박스와 개봉 낱개를 0으로 만듭니다.`}
          confirmLabel="소진"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await depleteWarehouseStock(brandId, dialog.row.id)
            setDialog(null)
            await invalidateStock()
          }}
          onError={setError}
        />
      ) : null}
      {dialog?.kind === 'adjust' ? (
        <AdjustDialog
          brandId={brandId}
          row={dialog.row}
          onClose={() => setDialog(null)}
          onDone={async () => {
            setDialog(null)
            await invalidateStock()
          }}
          onError={setError}
        />
      ) : null}
      {dialog?.kind === 'open' ? (
        <OpenDialog
          brandId={brandId}
          row={dialog.row}
          onClose={() => setDialog(null)}
          onDone={async () => {
            setDialog(null)
            await invalidateStock()
          }}
          onError={setError}
        />
      ) : null}
      {dialog?.kind === 'history' ? (
        <HistoryDialog
          brandId={brandId}
          setId={activeSet?.id}
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
}: {
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-muted"
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

function ReceiveDialog({
  brandId,
  onClose,
  onDone,
  onError,
}: {
  brandId: string
  onClose: () => void
  onDone: () => Promise<void>
  onError: (message: string | null) => void
}) {
  const [style, setStyle] = useState<StyleRef | null>(null)
  const [locationRaw, setLocationRaw] = useState('')
  const [receivedRaw, setReceivedRaw] = useState('')
  const [forced, setForced] = useState(false)
  const [units, setUnits] = useState('20')
  const [boxes, setBoxes] = useState('1')
  const mutation = useMutation({
    mutationFn: async () => {
      const location = parseWarehouseLocation(locationRaw)
      const received = forced
        ? parseWarehouseReceivedOn(FORCED_PRIORITY_DATE)
        : parseWarehouseReceivedOn(receivedRaw)
      if (!location.locationCode) throw new Error('자리번호를 입력하세요.')
      const unitsPerBox = Number(units)
      const remainingBoxes = Number(boxes)
      if (!Number.isFinite(unitsPerBox) || unitsPerBox < 1) {
        throw new Error('박스당 수량을 확인하세요.')
      }
      if (!Number.isFinite(remainingBoxes) || remainingBoxes < 1) {
        throw new Error('박스 수를 확인하세요.')
      }
      await receiveWarehouseStock(brandId, {
        styleId: style?.styleId ?? null,
        sourceStyleNo: style?.styleNo ?? '',
        sourceProductName: style?.name ?? '',
        locationCode: location.locationCode,
        isFinalLocation: location.isFinalLocation,
        receivedOn: received.receivedOn,
        receivedOnRaw: received.receivedOnRaw,
        isForcedPriority: received.isForcedPriority,
        unitsPerBox,
        remainingBoxes,
      })
    },
    onSuccess: async () => {
      onError(null)
      await onDone()
    },
    onError: (err) => {
      onError(err instanceof Error ? err.message : '입고에 실패했습니다.')
    },
  })

  return (
    <Overlay title="신규 입고" onClose={onClose}>
      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">상품</span>
        <StylePicker brandId={brandId} value={style} onChange={setStyle} />
      </label>
      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">
          자리번호 (`{FINAL_LOCATION_MARK}`이면 마지막 위치)
        </span>
        <Input value={locationRaw} onChange={(e) => setLocationRaw(e.target.value)} />
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
          입고
        </Button>
      </div>
    </Overlay>
  )
}

function MoveDialog({
  brandId,
  row,
  replenish,
  onClose,
  onDone,
  onError,
}: {
  brandId: string
  row: WarehouseStockPosition
  replenish: boolean
  onClose: () => void
  onDone: () => Promise<void>
  onError: (message: string | null) => void
}) {
  const [toCode, setToCode] = useState(replenish ? row.locationCode : '')
  const [boxCount, setBoxCount] = useState(String(row.remainingBoxes))
  const mutation = useMutation({
    mutationFn: async () => {
      const count = Number(boxCount)
      if (!toCode.trim()) throw new Error('옮길 자리번호를 입력하세요.')
      await moveWarehouseStock(
        brandId,
        {
          positionId: row.id,
          toLocationCode: toCode.trim(),
          toZone: replenish ? 'picking' : 'box_storage',
          boxCount: count,
        },
        replenish ? 'replenish' : 'move',
      )
    },
    onSuccess: async () => {
      onError(null)
      await onDone()
    },
    onError: (err) => {
      onError(err instanceof Error ? err.message : '이동에 실패했습니다.')
    },
  })

  return (
    <Overlay
      title={replenish ? '출고창고 박스 충원' : '전체 박스 위치 이동'}
      onClose={onClose}
    >
      <p className="text-xs text-muted-foreground">
        {row.styleNo} · {formatWarehouseLocation(row)} · 잔여 {formatNumber(row.remainingBoxes)}박스.
        일부만 옮기면 원래 입고일을 유지한 새 행으로 나눕니다.
      </p>
      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">도착 자리번호</span>
        <Input value={toCode} onChange={(e) => setToCode(e.target.value)} />
      </label>
      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">옮길 박스 수</span>
        <Input value={boxCount} onChange={(e) => setBoxCount(e.target.value)} />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          취소
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={mutation.isPending || row.remainingBoxes < 1}
          onClick={() => mutation.mutate()}
        >
          {replenish ? '충원' : '이동'}
        </Button>
      </div>
    </Overlay>
  )
}

function AdjustDialog({
  brandId,
  row,
  onClose,
  onDone,
  onError,
}: {
  brandId: string
  row: WarehouseStockPosition
  onClose: () => void
  onDone: () => Promise<void>
  onError: (message: string | null) => void
}) {
  const [boxes, setBoxes] = useState(String(row.remainingBoxes))
  const [opened, setOpened] = useState(String(row.openedUnits))
  const mutation = useMutation({
    mutationFn: async () => {
      await adjustWarehouseStock(brandId, {
        positionId: row.id,
        remainingBoxes: Number(boxes),
        openedUnits: Number(opened),
      })
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
          <span className="text-muted-foreground">잔여 박스</span>
          <Input value={boxes} onChange={(e) => setBoxes(e.target.value)} />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">개봉 낱개</span>
          <Input value={opened} onChange={(e) => setOpened(e.target.value)} />
        </label>
      </div>
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

function OpenDialog({
  brandId,
  row,
  onClose,
  onDone,
  onError,
}: {
  brandId: string
  row: WarehouseStockPosition
  onClose: () => void
  onDone: () => Promise<void>
  onError: (message: string | null) => void
}) {
  const [boxCount, setBoxCount] = useState('1')
  const mutation = useMutation({
    mutationFn: async () => {
      await openWarehouseStock(brandId, row.id, Number(boxCount))
    },
    onSuccess: async () => {
      onError(null)
      await onDone()
    },
    onError: (err) => {
      onError(err instanceof Error ? err.message : '개봉에 실패했습니다.')
    },
  })

  return (
    <Overlay title="박스 개봉" onClose={onClose}>
      <p className="text-xs text-muted-foreground">
        출고창고에서 박스를 열어 낱개로 바꿉니다. 남은 박스 {formatNumber(row.remainingBoxes)}.
      </p>
      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">개봉할 박스 수</span>
        <Input value={boxCount} onChange={(e) => setBoxCount(e.target.value)} />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          취소
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={mutation.isPending || row.remainingBoxes < 1}
          onClick={() => mutation.mutate()}
        >
          개봉
        </Button>
      </div>
    </Overlay>
  )
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onClose,
  onConfirm,
  onError,
}: {
  title: string
  body: string
  confirmLabel: string
  onClose: () => void
  onConfirm: () => Promise<void>
  onError: (message: string | null) => void
}) {
  const mutation = useMutation({
    mutationFn: onConfirm,
    onError: (err) => {
      onError(err instanceof Error ? err.message : '작업에 실패했습니다.')
    },
  })
  return (
    <Overlay title={title} onClose={onClose}>
      <p className="text-xs text-muted-foreground">{body}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          취소
        </Button>
        <Button
          type="button"
          size="sm"
          variant="danger"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {confirmLabel}
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
    queryFn: () => getWarehouseStockMovements(brandId, setId!, row?.id),
    enabled: Boolean(setId),
  })
  const movements = query.data ?? []

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
