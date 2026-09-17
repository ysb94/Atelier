import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ClipboardCheck, Printer, X } from 'lucide-react'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tabs'
import { ProductThumb } from '@/components/products/ProductThumb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { CargoInboundLineDraft } from '@/lib/cargo/inbound'
import { cargoLineHasContent } from '@/lib/cargo/inbound'
import { useRenderWatch } from '@/lib/diagnostics'
import {
  LOGISTICS_IMAGE_KEY,
  PRODUCT_IMAGE_KEY,
  pickImageSources,
  ruleImageUrls,
} from '@/lib/products/product-image'
import { formatNumber } from '@/lib/utils'

type CargoInspectionDialogProps = {
  title: string
  brandName: string
  lines: CargoInboundLineDraft[]
  onClose: () => void
}

type PrintOrientation = 'auto' | 'portrait' | 'landscape'

const PRINT_CLASS = 'printing-cargo-inspection'
const PRINT_STYLE_ID = 'cargo-inspection-print-style'
const PRINT_NODE_CLASS = 'cargo-inspection-print'
/** 사진 열이 있어서 조금 적어도 가로로 뽑는다. */
const LANDSCAPE_PRINT_MIN_ROWS = 8
const SCREEN_PHOTO_SIZE = 56
const PRINT_PHOTO_LANDSCAPE = 44
const PRINT_PHOTO_PORTRAIT = 36

function applyInspectionPrintMode(landscape: boolean) {
  document.documentElement.classList.add(PRINT_CLASS)
  let style = document.getElementById(PRINT_STYLE_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = PRINT_STYLE_ID
    document.head.appendChild(style)
  }
  const pageSize = landscape ? 'A4 landscape' : 'A4 portrait'
  const pageMargin = landscape ? '8mm 8mm' : '10mm 8mm'
  const tableFont = landscape ? '12px' : '11px'
  const titleFont = landscape ? '18px' : '16px'
  const metaFont = landscape ? '12px' : '11px'
  const imgSize = landscape
    ? `${PRINT_PHOTO_LANDSCAPE}px`
    : `${PRINT_PHOTO_PORTRAIT}px`
  const rowHeight = landscape ? '52px' : '44px'
  const cellPad = landscape ? '4px 6px' : '3px 5px'
  style.textContent = `
@page { size: ${pageSize}; margin: ${pageMargin}; }
@media screen {
  .${PRINT_NODE_CLASS} { display: none !important; }
}
@media print {
  html.${PRINT_CLASS},
  html.${PRINT_CLASS} body {
    height: auto !important;
    overflow: visible !important;
    background: #fff !important;
  }
  html.${PRINT_CLASS} body > :not(.${PRINT_NODE_CLASS}) {
    display: none !important;
  }
  html.${PRINT_CLASS} .${PRINT_NODE_CLASS} {
    display: block !important;
    position: static !important;
    inset: auto !important;
    width: 100% !important;
    height: auto !important;
    max-height: none !important;
    overflow: visible !important;
    color: #111;
    background: #fff;
    font-family: sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  html.${PRINT_CLASS} .${PRINT_NODE_CLASS} h1 {
    font-size: ${titleFont};
    margin: 0 0 4px;
  }
  html.${PRINT_CLASS} .${PRINT_NODE_CLASS} p {
    margin: 0 0 10px;
    color: #555;
    font-size: ${metaFont};
  }
  html.${PRINT_CLASS} .${PRINT_NODE_CLASS} table {
    width: 100% !important;
    border-collapse: collapse;
    table-layout: auto;
    font-size: ${tableFont};
  }
  html.${PRINT_CLASS} .${PRINT_NODE_CLASS} thead {
    display: table-header-group;
  }
  html.${PRINT_CLASS} .${PRINT_NODE_CLASS} tbody tr {
    height: ${rowHeight};
    break-inside: avoid;
    page-break-inside: avoid;
  }
  html.${PRINT_CLASS} .${PRINT_NODE_CLASS} tbody tr:nth-child(even) td {
    background: #edf2f6 !important;
  }
  html.${PRINT_CLASS} .${PRINT_NODE_CLASS} th,
  html.${PRINT_CLASS} .${PRINT_NODE_CLASS} td {
    border: 1px solid #9aa6b2;
    padding: ${cellPad};
    text-align: center;
    vertical-align: middle;
    overflow: hidden;
    height: ${rowHeight};
    white-space: nowrap;
  }
  html.${PRINT_CLASS} .${PRINT_NODE_CLASS} th {
    background: #243447;
    color: #fff;
    font-weight: 600;
  }
  html.${PRINT_CLASS} .${PRINT_NODE_CLASS} th.fit,
  html.${PRINT_CLASS} .${PRINT_NODE_CLASS} td.fit {
    width: 1%;
  }
  html.${PRINT_CLASS} .${PRINT_NODE_CLASS} td.name {
    text-align: left;
  }
  html.${PRINT_CLASS} .${PRINT_NODE_CLASS} td.note,
  html.${PRINT_CLASS} .${PRINT_NODE_CLASS} th.note {
    width: 99%;
    text-align: left;
  }
  html.${PRINT_CLASS} .${PRINT_NODE_CLASS} td.photo {
    overflow: visible;
    padding: 3px;
  }
  html.${PRINT_CLASS} .${PRINT_NODE_CLASS} td.photo img,
  html.${PRINT_CLASS} .${PRINT_NODE_CLASS} td.photo .photo-thumb {
    width: ${imgSize} !important;
    height: ${imgSize} !important;
    object-fit: cover;
    display: block;
    margin: 0 auto;
  }
}
`
}

function clearInspectionPrintMode() {
  document.documentElement.classList.remove(PRINT_CLASS)
  document.getElementById(PRINT_STYLE_ID)?.remove()
}

function InspectionPhoto({
  photo,
  styleNo,
  name,
  size = SCREEN_PHOTO_SIZE,
  eager = false,
}: {
  photo: string
  styleNo: string
  name: string
  size?: number
  eager?: boolean
}) {
  const sources = useMemo(() => {
    const logistics = pickImageSources(photo, styleNo, LOGISTICS_IMAGE_KEY)
    const product = styleNo ? ruleImageUrls(styleNo, PRODUCT_IMAGE_KEY) : []
    const seen = new Set<string>()
    return [...logistics, ...product].filter((url) => {
      if (seen.has(url)) return false
      seen.add(url)
      return true
    })
  }, [photo, styleNo])

  return (
    <div className="flex items-center justify-center">
      <ProductThumb
        sources={sources}
        alt={name || styleNo || '상품 사진'}
        size={size}
        loading={eager ? 'eager' : 'lazy'}
        className="photo-thumb"
      />
    </div>
  )
}

export function CargoInspectionDialog({
  title,
  brandName,
  lines,
  onClose,
}: CargoInspectionDialogProps) {
  useRenderWatch('CargoInspectionDialog')
  const [printOrientation, setPrintOrientation] =
    useState<PrintOrientation>('auto')

  useEffect(() => {
    const afterPrint = () => clearInspectionPrintMode()
    window.addEventListener('afterprint', afterPrint)
    return () => {
      window.removeEventListener('afterprint', afterPrint)
      clearInspectionPrintMode()
    }
  }, [])

  const rows = useMemo(
    () =>
      lines
        .filter(cargoLineHasContent)
        .map((line, index) => ({
          key: `${line.styleNo || line.name || 'line'}-${index}`,
          no: line.no.trim() || String(index + 1),
          name: line.name.trim() || '-',
          photo: line.photo.trim(),
          styleNo: line.styleNo.trim(),
          qty: line.qty.trim() || '-',
          perBox: line.perBox.trim() || '-',
          boxes: line.boxes.trim() || '-',
          note: line.note.trim(),
        })),
    [lines],
  )

  const autoPrintLandscape = rows.length >= LANDSCAPE_PRINT_MIN_ROWS
  const autoPrintOrientationLabel = autoPrintLandscape ? '가로' : '세로'
  const printLandscape =
    printOrientation === 'landscape' ||
    (printOrientation === 'auto' && autoPrintLandscape)
  const printOrientationLabel = printLandscape ? '가로' : '세로'
  const printPhotoSize = printLandscape
    ? PRINT_PHOTO_LANDSCAPE
    : PRINT_PHOTO_PORTRAIT

  function handlePrint() {
    if (rows.length === 0) return
    applyInspectionPrintMode(printLandscape)
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => window.print()),
    )
  }

  return createPortal(
    <WorkspaceTabOverlay>
      <>
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4">
          <button
            type="button"
            aria-label="검수용 닫기"
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cargo-inspection-title"
            className="relative z-10 flex max-h-[92vh] w-full max-w-[min(96vw,72rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <h2
                  id="cargo-inspection-title"
                  className="text-base font-semibold tracking-tight"
                >
                  검수용
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  입고 목록과 같고, 사진 열만 실제 이미지를 보여 인쇄할 수
                  있습니다.
                </p>
              </div>
              <Button type="button" size="icon" variant="ghost" onClick={onClose}>
                <X className="size-4" />
              </Button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="muted">{brandName}</Badge>
                <Badge variant="outline">{title}</Badge>
                <Badge variant={rows.length > 0 ? 'success' : 'muted'}>
                  {formatNumber(rows.length)}종
                </Badge>
              </div>
              <div className="flex items-center gap-1.5">
                <label
                  className="sr-only"
                  htmlFor="cargo-inspection-print-orientation"
                >
                  인쇄 방향
                </label>
                <select
                  id="cargo-inspection-print-orientation"
                  value={printOrientation}
                  onChange={(event) =>
                    setPrintOrientation(event.target.value as PrintOrientation)
                  }
                  className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
                  title="인쇄 방향 선택"
                >
                  <option value="auto">
                    자동 ({autoPrintOrientationLabel})
                  </option>
                  <option value="portrait">세로</option>
                  <option value="landscape">가로</option>
                </select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={rows.length === 0}
                  onClick={handlePrint}
                >
                  <Printer className="size-3.5" />
                  인쇄
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              {rows.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  검수할 상품이 없습니다.
                </p>
              ) : (
                <table className="w-full text-left text-sm">
                  <colgroup>
                    <col />
                    <col />
                    <col className="w-[4.5rem]" />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col className="w-[99%]" />
                  </colgroup>
                  <thead className="sticky top-0 z-10 bg-muted/90 text-xs text-muted-foreground">
                    <tr>
                      <th className="whitespace-nowrap px-3 py-2 font-medium">
                        NO
                      </th>
                      <th className="whitespace-nowrap px-3 py-2 font-medium">
                        품명
                      </th>
                      <th className="whitespace-nowrap px-3 py-2 text-center font-medium">
                        사진
                      </th>
                      <th className="whitespace-nowrap px-3 py-2 font-medium">
                        M번호
                      </th>
                      <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                        총수량
                      </th>
                      <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                        박스 당
                      </th>
                      <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                        박스
                      </th>
                      <th className="w-[99%] px-3 py-2 font-medium">비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.key} className="border-t border-border">
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                          {row.no}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-medium">
                          {row.name}
                        </td>
                        <td className="px-2 py-1.5">
                          <InspectionPhoto
                            photo={row.photo}
                            styleNo={row.styleNo}
                            name={row.name}
                          />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs font-semibold">
                          {row.styleNo || '-'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          {row.qty}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          {row.perBox}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          {row.boxes}
                        </td>
                        <td className="w-[99%] px-3 py-2 text-muted-foreground">
                          {row.note}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex justify-end border-t border-border px-4 py-3">
              <Button type="button" variant="outline" onClick={onClose}>
                닫기
              </Button>
            </div>
          </div>
        </div>
        <div className={`${PRINT_NODE_CLASS} hidden`} aria-hidden>
          <h1>{title} 검수용</h1>
          <p>
            {brandName} · {formatNumber(rows.length)}종 · {printOrientationLabel}
          </p>
          <table>
            <thead>
              <tr>
                <th className="fit">NO</th>
                <th className="fit">품명</th>
                <th className="fit">사진</th>
                <th className="fit">M번호</th>
                <th className="fit">총수량</th>
                <th className="fit">박스 당</th>
                <th className="fit">박스</th>
                <th className="note">비고</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`print-${row.key}`}>
                  <td className="fit">{row.no}</td>
                  <td className="fit name">{row.name}</td>
                  <td className="fit photo">
                    {row.styleNo ? (
                      <InspectionPhoto
                        photo={row.photo}
                        styleNo={row.styleNo}
                        name={row.name}
                        size={printPhotoSize}
                        eager
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="fit">{row.styleNo || '-'}</td>
                  <td className="fit">{row.qty}</td>
                  <td className="fit">{row.perBox}</td>
                  <td className="fit">{row.boxes}</td>
                  <td className="note">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    </WorkspaceTabOverlay>,
    document.body,
  )
}

export function CargoInspectionButton({
  title,
  brandName,
  lines,
}: {
  title: string
  brandName: string
  lines: CargoInboundLineDraft[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        <ClipboardCheck className="size-3.5" />
        검수용
      </Button>
      {open ? (
        <CargoInspectionDialog
          title={title}
          brandName={brandName}
          lines={lines}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}
