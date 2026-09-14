import { useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  Boxes,
  CalendarDays,
  ClipboardPaste,
  FileSpreadsheet,
  Package,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tabs'
import { useRenderWatch } from '@/lib/diagnostics'
import { timeInvoiceWork } from '@/lib/invoice/invoice-work-perf'
import { cn, formatNumber } from '@/lib/utils'

const CARGO_COLUMNS = [
  { key: 'no', label: 'NO', widthClass: 'w-[4.5%] lg:w-12', align: 'center' },
  { key: 'name', label: '품명', widthClass: 'w-[25%] lg:w-60', align: 'left' },
  {
    key: 'photo',
    label: '사진 (임시)',
    widthClass: 'w-[15%] lg:w-32',
    align: 'center',
  },
  {
    key: 'styleNo',
    label: 'M번호',
    widthClass: 'w-[10%] lg:w-24',
    align: 'center',
  },
  { key: 'qty', label: '총수량', widthClass: 'w-[9%] lg:w-20', align: 'center' },
  {
    key: 'perBox',
    label: '박스 당',
    widthClass: 'w-[9%] lg:w-20',
    align: 'center',
  },
  { key: 'boxes', label: '박스', widthClass: 'w-[7%] lg:w-16', align: 'center' },
  { key: 'note', label: '비고', widthClass: '', align: 'left' },
] as const

type CargoColumnKey = (typeof CARGO_COLUMNS)[number]['key']

export type CargoDraftRow = Record<CargoColumnKey, string>

export type CargoInboundRegisterPayload = {
  shipDate: string
  rows: CargoDraftRow[]
}

const EMPTY_ROW_COUNT = 8
const HEADER_ALIASES = [
  'NO',
  '품명',
  '사진',
  '모델명',
  'M번호',
  '총수량',
  '박스 당',
  '박스',
  '비고',
]

function todayShipDateValue() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function parseCount(value: string) {
  const parsed = Number(value.replaceAll(',', '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function emptyDraftRow(): CargoDraftRow {
  return {
    no: '',
    name: '',
    photo: '',
    styleNo: '',
    qty: '',
    perBox: '',
    boxes: '',
    note: '',
  }
}

function parseCargoPasteText(text: string): CargoDraftRow[] {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)

  if (lines.length === 0) return []

  const headerTokens = lines[0].split('\t').map((cell) => cell.trim())
  const looksLikeHeader = headerTokens.some((cell) =>
    HEADER_ALIASES.includes(cell),
  )
  const dataLines = looksLikeHeader ? lines.slice(1) : lines

  return dataLines.map((line, index) => {
    const cells = line.split('\t')
    // 엑셀 사진 열은 셀 이미지/수식이라 붙여넣기 값이 비거나 쓸모없다.
    // M번호(모델명 열)로 물류 이미지를 따로 불러온다.
    return {
      no: (cells[0] ?? '').trim() || String(index + 1),
      name: (cells[1] ?? '').trim(),
      photo: '',
      styleNo: (cells[3] ?? '').trim(),
      qty: (cells[4] ?? '').trim(),
      perBox: (cells[5] ?? '').trim(),
      boxes: (cells[6] ?? '').trim(),
      note: (cells[7] ?? '').trim(),
    }
  })
}

type CargoInboundAddPanelProps = {
  onCancel: () => void
  onRegister: (payload: CargoInboundRegisterPayload) => void
}

type CargoShipDateDialogProps = {
  shipDate: string
  onShipDateChange: (value: string) => void
  onClose: () => void
  onConfirm: () => void
}

/** 선적일은 화물 내용을 확인한 뒤, 실제 등록 직전에 한 번 더 확인한다. */
function CargoShipDateDialog({
  shipDate,
  onShipDateChange,
  onClose,
  onConfirm,
}: CargoShipDateDialogProps) {
  return createPortal(
    <WorkspaceTabOverlay>
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <button
          type="button"
          aria-label="선적일 등록 취소"
          className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
          onClick={onClose}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cargo-ship-date-title"
          className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-card shadow-lg"
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose()
          }}
        >
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h3
                id="cargo-ship-date-title"
                className="text-base font-semibold tracking-tight"
              >
                선적일 확인
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                선적이 완료된 날짜를 선택해 주세요.
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="선적일 등록 취소"
              onClick={onClose}
            >
              <X className="size-4" />
            </Button>
          </div>

          <div className="space-y-2 px-4 py-4">
            <label
              htmlFor="cargo-ship-date"
              className="text-sm font-medium text-foreground"
            >
              선적일
            </label>
            <Input
              id="cargo-ship-date"
              type="date"
              value={shipDate}
              autoFocus
              onChange={(event) => onShipDateChange(event.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
            <Button type="button" size="sm" variant="outline" onClick={onClose}>
              취소
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!shipDate}
              onClick={onConfirm}
            >
              선적됨에 등록
            </Button>
          </div>
        </div>
      </div>
    </WorkspaceTabOverlay>,
    document.body,
  )
}

export function CargoInboundAddPanel({
  onCancel,
  onRegister,
}: CargoInboundAddPanelProps) {
  useRenderWatch('CargoInboundAddPanel')
  const pasteBoxRef = useRef<HTMLDivElement>(null)
  const [shipDate, setShipDate] = useState(todayShipDateValue)
  const [shipDateDialogOpen, setShipDateDialogOpen] = useState(false)
  const [rows, setRows] = useState<CargoDraftRow[]>([])
  const [pasteActive, setPasteActive] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const displayRows = useMemo(
    () =>
      rows.length > 0
        ? rows
        : Array.from({ length: EMPTY_ROW_COUNT }, emptyDraftRow),
    [rows],
  )

  const summary = useMemo(
    () =>
      rows.reduce(
        (result, row) => ({
          totalQty: result.totalQty + parseCount(row.qty),
          totalBoxes: result.totalBoxes + parseCount(row.boxes),
          missingStyleNo:
            result.missingStyleNo + (row.styleNo.trim() ? 0 : 1),
        }),
        { totalQty: 0, totalBoxes: 0, missingStyleNo: 0 },
      ),
    [rows],
  )

  function applyPasteText(text: string) {
    const next = timeInvoiceWork('화물 입고 엑셀 붙여넣기 해석', () =>
      parseCargoPasteText(text),
    )
    if (next.length === 0) {
      setStatus('붙여넣은 내용에서 행을 찾지 못했습니다.')
      return
    }
    setRows(next)
    setStatus(`${formatNumber(next.length)}행 붙여넣었습니다.`)
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const text = event.clipboardData.getData('text/plain')
    if (!text.trim()) return
    event.preventDefault()
    applyPasteText(text)
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) {
      setStatus(
        `${file.name} 파일을 받았습니다. 엑셀 파일 읽기는 다음 단계에서 연결합니다. 지금은 표에서 복사한 뒤 붙여넣기 해 주세요.`,
      )
      return
    }
    const text = event.dataTransfer.getData('text/plain')
    if (text.trim()) applyPasteText(text)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">화물 추가</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            엑셀에서 표 전체를 복사한 뒤 아래 영역을 눌러 붙여넣으세요.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {rows.length > 0 ? (
            <Badge variant="muted">{formatNumber(rows.length)}행</Badge>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>
            <X className="size-3.5" />
            닫기
          </Button>
        </div>
      </div>

      <div
        ref={pasteBoxRef}
        role="grid"
        aria-label="화물 입고 엑셀 붙여넣기 표"
        tabIndex={0}
        className={cn(
          'overflow-hidden rounded-xl border bg-card outline-none transition-[border-color,box-shadow]',
          dragging || pasteActive
            ? 'border-primary/70 ring-2 ring-primary/20'
            : 'border-border hover:border-primary/40',
        )}
        onFocus={() => setPasteActive(true)}
        onBlur={(event) => {
          if (pasteBoxRef.current?.contains(event.relatedTarget as Node)) return
          setPasteActive(false)
        }}
        onClick={() => {
          setPasteActive(true)
          pasteBoxRef.current?.focus()
        }}
        onPaste={handlePaste}
        onDragEnter={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(event) => {
          if (pasteBoxRef.current?.contains(event.relatedTarget as Node)) return
          setDragging(false)
        }}
        onDrop={(event) => {
          void handleDrop(event)
        }}
      >
        <div className="flex flex-wrap items-center justify-end gap-3 border-b border-border bg-muted/25 px-3 py-3">
          <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {rows.length > 0 ? (
              <>
                <span className="inline-flex items-center gap-1">
                  <Package className="size-3.5" />
                  총 {formatNumber(summary.totalQty)}개
                </span>
                <span className="inline-flex items-center gap-1">
                  <Boxes className="size-3.5" />
                  {formatNumber(summary.totalBoxes)}박스
                </span>
                {summary.missingStyleNo > 0 ? (
                  <Badge variant="warning">
                    M번호 없음 {formatNumber(summary.missingStyleNo)}행
                  </Badge>
                ) : null}
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <ClipboardPaste className="size-3.5" />
                클릭 후 Ctrl+V
              </span>
            )}
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="flex items-center gap-3 border-b border-border bg-primary/[0.04] px-4 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileSpreadsheet className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {dragging
                  ? '여기에 놓아 주세요.'
                  : pasteActive
                    ? '이제 Ctrl+V를 누르세요.'
                    : '엑셀 표를 이곳에 붙여넣으세요.'}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                NO · 품명 · 사진 · M번호 · 총수량 · 박스 당 · 박스 · 비고 순서
              </p>
            </div>
          </div>
        ) : null}

        <div className="max-h-[min(58vh,36rem)] overflow-y-auto overflow-x-hidden">
          <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
            <colgroup>
              {CARGO_COLUMNS.map((column) => (
                <col key={column.key} className={column.widthClass} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr>
                {CARGO_COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    className={cn(
                      'whitespace-nowrap border-b border-r border-border bg-foreground px-1.5 py-2 text-[11px] font-semibold text-background last:border-r-0 lg:px-3 lg:text-xs',
                      column.key === 'name' && 'text-left',
                    )}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, index) => (
                <tr
                  key={`cargo-row-${index}`}
                  className="group odd:bg-card even:bg-muted/20 hover:bg-primary/[0.055]"
                >
                  {CARGO_COLUMNS.map((column) => {
                    if (column.key === 'photo') {
                      const styleNo =
                        rows.length > 0 ? row.styleNo.trim() : ''
                      return (
                        <td
                          key={`${column.key}-${index}`}
                          className="h-14 whitespace-nowrap border-b border-r border-border px-1 align-middle lg:px-2"
                        >
                          {styleNo ? (
                            <div
                              className="mx-auto flex h-10 w-full items-center justify-center rounded-md border border-danger/25 bg-danger/[0.07] px-1 lg:h-11"
                              title={styleNo}
                            >
                              <span className="truncate font-mono text-[clamp(1rem,1.7vw,1.75rem)] font-black leading-none tracking-tight text-danger">
                                {styleNo}
                              </span>
                            </div>
                          ) : null}
                        </td>
                      )
                    }

                    const value =
                      rows.length > 0
                        ? row[column.key]
                        : column.key === 'no'
                          ? String(index + 1)
                          : ''

                    return (
                      <td
                        key={`${column.key}-${index}`}
                        className={cn(
                          'h-14 overflow-hidden whitespace-nowrap border-b border-r border-border px-1.5 align-middle text-[11px] text-foreground last:border-r-0 lg:px-3 lg:text-xs',
                          column.align === 'left' ? 'text-left' : 'text-center',
                          column.key === 'no' && 'text-muted-foreground',
                          column.key === 'name' && 'font-medium',
                          ['qty', 'perBox', 'boxes'].includes(column.key) &&
                            'tabular-nums',
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
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {status ? (
          <p
            className="min-h-5 text-xs text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {status}
          </p>
        ) : (
          <span className="min-h-5" aria-hidden="true" />
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={rows.length === 0}
            onClick={() => {
              setRows([])
              setStatus(null)
            }}
          >
            비우기
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={rows.length === 0}
            onClick={() => setShipDateDialogOpen(true)}
          >
            <CalendarDays className="size-3.5" />
            선적됨에 등록
          </Button>
        </div>
      </div>

      {shipDateDialogOpen ? (
        <CargoShipDateDialog
          shipDate={shipDate}
          onShipDateChange={setShipDate}
          onClose={() => setShipDateDialogOpen(false)}
          onConfirm={() => {
            setShipDateDialogOpen(false)
            onRegister({ shipDate, rows })
          }}
        />
      ) : null}
    </div>
  )
}
