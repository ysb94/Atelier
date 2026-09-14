import { useState } from 'react'
import {
  ArrowLeft,
  CalendarDays,
  Copy,
  FileSpreadsheet,
  Printer,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { CargoDraftRow } from '@/features/logistics/CargoInboundAddPanel'
import { CargoStockCheckButton } from '@/features/logistics/CargoStockCheckDialog'
import { formatNumber } from '@/lib/utils'

export type CargoInboundDetailItem = {
  id: string
  stage: 'shipped' | 'scheduled' | 'done'
  brandName: string
  shipmentNo: string
  vesselName: string
  originPort: string
  productCount: number
  boxCount: number
  totalQty: number
  shippedAt: string
  scheduledInboundAt: string | null
  portContactNote: string | null
  lines: CargoDraftRow[]
}

type CargoInboundDetailPanelProps = {
  item: CargoInboundDetailItem
  onBack: () => void
  onSaveInboundDate: (inboundDate: string, note: string) => void
}

function formatDate(value: string | null) {
  if (!value) return '-'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(date)
}

function buildPrintTable(item: CargoInboundDetailItem) {
  const header = ['NO', '품명', 'M번호', '총수량', '박스 당', '박스', '비고']
  const body = item.lines
    .map((line, index) =>
      [
        line.no || String(index + 1),
        line.name,
        line.styleNo,
        line.qty,
        line.perBox,
        line.boxes,
        line.note,
      ].join('\t'),
    )
    .join('\n')
  return `${header.join('\t')}\n${body}`
}

export function CargoInboundDetailPanel({
  item,
  onBack,
  onSaveInboundDate,
}: CargoInboundDetailPanelProps) {
  const [inboundDate, setInboundDate] = useState(
    item.scheduledInboundAt ?? '',
  )
  const [note, setNote] = useState(item.portContactNote ?? '')
  const [status, setStatus] = useState<string | null>(null)

  async function copyList() {
    try {
      await navigator.clipboard.writeText(buildPrintTable(item))
      setStatus('상품 리스트를 복사했습니다.')
    } catch (error) {
      console.warn('[cargo-inbound] 리스트 복사 실패', { error })
      setStatus('복사에 실패했습니다.')
    }
  }

  function printList() {
    const html = `
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>${item.shipmentNo} 화물 리스트</title>
  <style>
    body { font-family: sans-serif; padding: 24px; color: #111; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    p { margin: 0 0 16px; color: #555; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #bbb; padding: 6px 8px; text-align: left; }
    th { background: #f3f3f3; }
    td.num { text-align: right; }
  </style>
</head>
<body>
  <h1>${item.shipmentNo}</h1>
  <p>선적일 ${formatDate(item.shippedAt)} · 상품 ${item.productCount} · 박스 ${item.boxCount}</p>
  <table>
    <thead>
      <tr>
        <th>NO</th><th>품명</th><th>M번호</th><th>총수량</th><th>박스 당</th><th>박스</th><th>비고</th>
      </tr>
    </thead>
    <tbody>
      ${item.lines
        .map(
          (line, index) => `
        <tr>
          <td>${line.no || index + 1}</td>
          <td>${line.name}</td>
          <td>${line.styleNo}</td>
          <td class="num">${line.qty}</td>
          <td class="num">${line.perBox}</td>
          <td class="num">${line.boxes}</td>
          <td>${line.note}</td>
        </tr>`,
        )
        .join('')}
    </tbody>
  </table>
</body>
</html>`
    const popup = window.open('', '_blank', 'noopener,noreferrer,width=960,height=720')
    if (!popup) {
      setStatus('인쇄 창을 열 수 없습니다. 팝업을 허용해 주세요.')
      return
    }
    popup.document.write(html)
    popup.document.close()
    popup.focus()
    popup.print()
  }

  function downloadCsv() {
    const csv = buildPrintTable(item)
    const blob = new Blob([`\uFEFF${csv}`], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${item.shipmentNo}.csv`
    link.click()
    URL.revokeObjectURL(url)
    setStatus('CSV 파일을 내려받았습니다.')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Button type="button" size="sm" variant="outline" onClick={onBack}>
            <ArrowLeft className="size-3.5" />
            목록으로
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight">
                {item.shipmentNo}
              </h2>
              <Badge variant="muted">{item.brandName}</Badge>
              {item.stage === 'shipped' ? (
                <Badge variant="warning">입고일 미정</Badge>
              ) : null}
              {item.stage === 'scheduled' ? (
                <Badge variant="outline">입고일 확정</Badge>
              ) : null}
              {item.stage === 'done' ? (
                <Badge variant="success">정리 완료</Badge>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              선적일 {formatDate(item.shippedAt)} · 상품{' '}
              {formatNumber(item.productCount)} · 박스{' '}
              {formatNumber(item.boxCount)}
              {item.totalQty > 0
                ? ` · 총수량 ${formatNumber(item.totalQty)}`
                : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={copyList}>
            <Copy className="size-3.5" />
            리스트 복사
          </Button>
          <CargoStockCheckButton lines={item.lines} />
          <Button type="button" size="sm" variant="outline" onClick={downloadCsv}>
            <FileSpreadsheet className="size-3.5" />
            CSV
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={printList}>
            <Printer className="size-3.5" />
            인쇄
          </Button>
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-[1fr_1fr_auto]">
        <label className="space-y-1.5">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CalendarDays className="size-3.5" />
            입고일
          </span>
          <Input
            type="date"
            value={inboundDate}
            onChange={(event) => setInboundDate(event.target.value)}
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            항구 협의 메모
          </span>
          <Input
            value={note}
            placeholder="예: 오전 입고 / 오후 2시 이후"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <div className="flex items-end">
          <Button
            type="button"
            className="w-full md:w-auto"
            disabled={!inboundDate}
            onClick={() => {
              onSaveInboundDate(inboundDate, note.trim())
              setStatus('입고일을 저장하고 협의 목록으로 옮겼습니다.')
            }}
          >
            입고일 확정
          </Button>
        </div>
      </div>

      {status ? (
        <p className="text-xs text-muted-foreground" role="status">
          {status}
        </p>
      ) : null}

      {item.lines.length === 0 ? (
        <p className="rounded-lg border border-border px-4 py-10 text-center text-sm text-muted-foreground">
          등록된 상품 상세가 없습니다.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">NO</th>
                <th className="px-3 py-2 font-medium">품명</th>
                <th className="px-3 py-2 font-medium">사진</th>
                <th className="px-3 py-2 font-medium">M번호</th>
                <th className="px-3 py-2 text-right font-medium">총수량</th>
                <th className="px-3 py-2 text-right font-medium">박스 당</th>
                <th className="px-3 py-2 text-right font-medium">박스</th>
                <th className="px-3 py-2 font-medium">비고</th>
              </tr>
            </thead>
            <tbody>
              {item.lines.map((line, index) => (
                <tr key={`${item.id}-line-${index}`} className="border-t border-border">
                  <td className="px-3 py-2 text-muted-foreground">
                    {line.no || index + 1}
                  </td>
                  <td className="px-3 py-2">{line.name}</td>
                  <td className="px-3 py-2">
                    {line.styleNo ? (
                      <span className="font-black text-[#ff0000]">
                        {line.styleNo}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {line.styleNo || '-'}
                  </td>
                  <td className="px-3 py-2 text-right">{line.qty || '-'}</td>
                  <td className="px-3 py-2 text-right">{line.perBox || '-'}</td>
                  <td className="px-3 py-2 text-right">{line.boxes || '-'}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {line.note || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
