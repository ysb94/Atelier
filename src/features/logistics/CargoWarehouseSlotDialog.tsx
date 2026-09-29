import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Download, Loader2, X } from 'lucide-react'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CargoLinePhoto } from '@/features/logistics/CargoUnloadListDialog'
import {
  CARGO_LINE_LIST_COLUMNS,
  type CargoLineListColumnKey,
} from '@/features/logistics/cargo-line-list-columns'
import {
  getCargoInboundTidyRows,
  type CargoInboundTidyRow,
  type CargoInboundTidySlotInput,
} from '@/lib/api'
import {
  formatCargoLineListCells,
  storedRowToCargoLineListValues,
} from '@/lib/cargo/line-list'
import { useRenderWatch } from '@/lib/diagnostics'
import {
  LOGISTICS_IMAGE_KEY,
  ruleImageUrls,
} from '@/lib/products/product-image'
import { cn, emptyList, formatNumber } from '@/lib/utils'

type CargoWarehouseSlotDialogProps = {
  title: string
  brandId: string
  brandName: string
  shipmentId: string
  onClose: () => void
  onSave: (
    slots: readonly CargoInboundTidySlotInput[],
    complete: boolean,
  ) => Promise<void>
}

function cellText(
  cells: ReturnType<typeof formatCargoLineListCells>,
  key: CargoLineListColumnKey,
) {
  if (key === 'photo' || key === 'slot') return ''
  return cells[key]
}

function safeExcelFileName(value: string) {
  const safe = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
  return safe || '화물입고'
}

export function CargoWarehouseSlotDialog({
  title,
  brandId,
  brandName,
  shipmentId,
  onClose,
  onSave,
}: CargoWarehouseSlotDialogProps) {
  useRenderWatch('CargoWarehouseSlotDialog')
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [downloadingExcel, setDownloadingExcel] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const tidyQuery = useQuery({
    queryKey: ['cargo-inbound-tidy', brandId, shipmentId],
    queryFn: () => getCargoInboundTidyRows(brandId, shipmentId),
    enabled: Boolean(brandId && shipmentId),
  })
  const rows = tidyQuery.data ?? emptyList<CargoInboundTidyRow>()
  const displayRows = useMemo(
    () =>
      rows.map((row) => ({
        row,
        cells: formatCargoLineListCells(storedRowToCargoLineListValues(row)),
      })),
    [rows],
  )
  const busy = saving || completing || downloadingExcel

  function slotValue(row: CargoInboundTidyRow) {
    return edits[row.id] ?? row.warehouseSlot
  }

  const dirty = rows.some((row) => slotValue(row) !== row.warehouseSlot)
  const blankCount = rows.filter((row) => slotValue(row).trim() === '').length
  const filledCount = rows.length - blankCount

  function requestClose() {
    if (busy) return
    if (
      dirty &&
      !window.confirm('저장하지 않은 창고자리가 있습니다. 닫을까요?')
    ) {
      return
    }
    onClose()
  }

  function focusNextSlot(index: number) {
    document
      .querySelector<HTMLInputElement>(
        `[data-warehouse-slot-index="${index + 1}"]`,
      )
      ?.focus()
  }

  async function handleDownloadExcel() {
    if (busy || tidyQuery.isLoading || rows.length === 0) return
    setDownloadingExcel(true)
    setError(null)
    try {
      const XLSX = await import('xlsx')
      const headers = CARGO_LINE_LIST_COLUMNS.map((column) =>
        column.key === 'photo' ? '사진 URL' : column.label,
      )
      const body = rows.map((row) => {
        const cells = formatCargoLineListCells({
          ...storedRowToCargoLineListValues(row),
          warehouseSlot: slotValue(row),
        })
        return CARGO_LINE_LIST_COLUMNS.map((column) => {
          if (column.key === 'photo') {
            return ruleImageUrls(cells.styleNo, LOGISTICS_IMAGE_KEY)[0] ?? ''
          }
          return cells[column.key]
        })
      })
      const sheet = XLSX.utils.aoa_to_sheet([headers, ...body])
      sheet['!cols'] = [
        { wch: 7 },
        { wch: 30 },
        { wch: 48 },
        { wch: 14 },
        { wch: 12 },
        { wch: 10 },
        { wch: 10 },
        { wch: 12 },
        { wch: 14 },
        { wch: 32 },
        { wch: 12 },
        { wch: 18 },
        { wch: 12 },
      ]
      if (sheet['!ref']) {
        sheet['!autofilter'] = { ref: sheet['!ref'] }
      }
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, sheet, '창고자리')
      XLSX.writeFile(workbook, `${safeExcelFileName(title)}_창고자리.xlsx`)
    } catch (downloadError) {
      console.warn('[cargo-inbound] 창고자리 엑셀 다운로드 실패', {
        shipmentId,
        error: downloadError,
      })
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : '엑셀을 만들지 못했습니다.',
      )
    } finally {
      setDownloadingExcel(false)
    }
  }

  async function saveSlots(complete: boolean) {
    if (busy || tidyQuery.isLoading || rows.length === 0) return
    if (
      complete &&
      blankCount > 0 &&
      !window.confirm(
        `창고자리가 비어 있는 행이 ${formatNumber(blankCount)}개 있습니다. 그대로 완료할까요?`,
      )
    ) {
      return
    }
    if (complete) setCompleting(true)
    else setSaving(true)
    setError(null)
    setStatus(null)
    try {
      await onSave(
        rows.map((row) => ({
          id: row.id,
          warehouseSlot: slotValue(row).trim(),
        })),
        complete,
      )
      if (!complete) {
        setEdits({})
        setStatus('창고자리를 저장했습니다.')
      }
    } catch (saveError) {
      console.warn('[cargo-inbound] 창고자리 저장 실패', {
        shipmentId,
        complete,
        error: saveError,
      })
      setError(
        saveError instanceof Error
          ? saveError.message
          : '창고자리를 저장하지 못했습니다.',
      )
    } finally {
      setSaving(false)
      setCompleting(false)
    }
  }

  return createPortal(
    <WorkspaceTabOverlay>
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-4">
        <button
          type="button"
          aria-label="창고자리 입력 닫기"
          className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
          onClick={requestClose}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cargo-warehouse-slot-title"
          className="relative z-10 flex max-h-[92vh] w-full max-w-[min(96vw,90rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
        >
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2
                id="cargo-warehouse-slot-title"
                className="text-base font-semibold tracking-tight"
              >
                창고자리 입력
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                인쇄할 때 저장된 창고정리용 목록입니다. 창고자리만 입력합니다.
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={requestClose}
            >
              <X className="size-4" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
            <Badge variant="muted">{brandName}</Badge>
            <Badge variant="outline">{title}</Badge>
            <Badge variant={rows.length > 0 ? 'outline' : 'muted'}>
              {formatNumber(rows.length)}행
            </Badge>
            <Badge variant={filledCount > 0 ? 'success' : 'muted'}>
              창고자리 {formatNumber(filledCount)}/{formatNumber(rows.length)}
            </Badge>
            {status ? (
              <span className="text-xs text-muted-foreground" role="status">
                {status}
              </span>
            ) : null}
            {error ? <span className="text-xs text-danger">{error}</span> : null}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {tidyQuery.isLoading ? (
              <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3 px-4 py-10">
                <Loader2 className="size-8 animate-spin text-foreground" />
                <p className="text-sm text-muted-foreground">
                  저장된 목록을 불러오는 중...
                </p>
              </div>
            ) : tidyQuery.isError ? (
              <p className="px-4 py-10 text-center text-sm text-danger">
                저장된 목록을 불러오지 못했습니다.
              </p>
            ) : displayRows.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                저장된 창고정리용 목록이 없습니다.
              </p>
            ) : (
              <table className="w-full min-w-[74rem] table-fixed border-separate border-spacing-0 text-sm">
                <colgroup>
                  {CARGO_LINE_LIST_COLUMNS.map((column) => (
                    <col key={column.key} className={column.widthClass} />
                  ))}
                </colgroup>
                <thead className="sticky top-0 z-20">
                  <tr>
                    {CARGO_LINE_LIST_COLUMNS.map((column) => (
                      <th
                        key={column.key}
                        className={cn(
                          'whitespace-nowrap border-b border-r border-border bg-foreground px-1 py-1.5 text-center text-[13px] font-semibold text-background last:border-r-0',
                          column.align === 'left' && 'text-left',
                        )}
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map(({ row, cells }, index) => (
                    <tr key={row.id} className="odd:bg-card even:bg-muted/20">
                      {CARGO_LINE_LIST_COLUMNS.map((column) => {
                        if (column.key === 'photo') {
                          return (
                            <td
                              key={`${row.id}-photo`}
                              className="h-11 border-b border-r border-border px-0.5 align-middle"
                            >
                              <CargoLinePhoto
                                styleNo={cells.styleNo}
                                name={cells.name}
                              />
                            </td>
                          )
                        }
                        if (column.key === 'slot') {
                          return (
                            <td
                              key={`${row.id}-slot`}
                              className="h-11 border-b border-r border-border px-1 align-middle"
                            >
                              <Input
                                value={slotValue(row)}
                                disabled={busy}
                                aria-label={`${cells.no} ${cells.name || cells.styleNo} 창고자리`}
                                data-warehouse-slot-index={index}
                                className="h-8 px-1 text-center"
                                onChange={(event) => {
                                  const value = event.target.value
                                  setEdits((prev) => ({
                                    ...prev,
                                    [row.id]: value,
                                  }))
                                  setStatus(null)
                                }}
                                onKeyDown={(event) => {
                                  if (event.key !== 'Enter') return
                                  event.preventDefault()
                                  focusNextSlot(index)
                                }}
                              />
                            </td>
                          )
                        }
                        const value = cellText(cells, column.key)
                        const isNote = column.key === 'note'
                        return (
                          <td
                            key={`${row.id}-${column.key}`}
                            className={cn(
                              'border-b border-r border-border px-1 align-middle text-sm leading-tight text-foreground last:border-r-0',
                              isNote
                                ? 'min-h-11 whitespace-pre-line'
                                : 'h-11 overflow-hidden whitespace-nowrap',
                              column.align === 'left'
                                ? 'text-left'
                                : 'text-center',
                              column.key === 'no' && 'text-muted-foreground',
                              column.key === 'name' && 'font-medium',
                              [
                                'qty',
                                'perBox',
                                'boxes',
                                'latestBoxes',
                              ].includes(column.key) && 'tabular-nums',
                            )}
                            title={value || undefined}
                          >
                            {value}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={requestClose}
            >
              닫기
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={
                busy || tidyQuery.isLoading || rows.length === 0
              }
              onClick={() => void handleDownloadExcel()}
            >
              {downloadingExcel ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              {downloadingExcel ? '엑셀 생성 중...' : '엑셀 다운로드'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || tidyQuery.isLoading || rows.length === 0}
              onClick={() => void saveSlots(false)}
            >
              {saving ? '저장 중...' : '저장'}
            </Button>
            <Button
              type="button"
              disabled={busy || tidyQuery.isLoading || rows.length === 0}
              onClick={() => void saveSlots(true)}
            >
              {completing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="size-3.5" />
              )}
              {completing ? '완료 처리 중...' : '완료 처리'}
            </Button>
          </div>
        </div>
      </div>
    </WorkspaceTabOverlay>,
    document.body,
  )
}
