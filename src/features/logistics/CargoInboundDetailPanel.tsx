import { useState } from 'react'
import { ArrowLeft, CalendarDays } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CargoStockCheckButton } from '@/features/logistics/CargoStockCheckDialog'
import { formatCargoInboundTitle } from '@/features/logistics/cargo-inbound-title'
import type { CargoInboundLineDraft } from '@/lib/cargo/inbound'
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
  lines: CargoInboundLineDraft[]
}

type CargoInboundDetailPanelProps = {
  item: CargoInboundDetailItem
  onBack: () => void
  onSaveInboundDate: (inboundDate: string, note: string) => Promise<void>
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

export function CargoInboundDetailPanel({
  item,
  onBack,
  onSaveInboundDate,
}: CargoInboundDetailPanelProps) {
  const title = formatCargoInboundTitle(item.shippedAt, item.boxCount)
  const [inboundDate, setInboundDate] = useState(
    item.scheduledInboundAt ?? '',
  )
  const [note, setNote] = useState(item.portContactNote ?? '')
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function saveInboundDate() {
    setSaving(true)
    setStatus(null)
    try {
      await onSaveInboundDate(inboundDate, note.trim())
    } catch (error) {
      console.warn('[cargo-inbound] 입고일 저장 실패', {
        shipmentId: item.id,
        inboundDate,
        error,
      })
      setStatus(
        error instanceof Error ? error.message : '입고일 저장에 실패했습니다.',
      )
    } finally {
      setSaving(false)
    }
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
                {title}
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

        {item.stage === 'scheduled' || item.stage === 'done' ? (
          <div className="flex flex-wrap gap-2">
            <CargoStockCheckButton lines={item.lines} />
          </div>
        ) : null}
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
            disabled={!inboundDate || saving}
            onClick={() => void saveInboundDate()}
          >
            {saving ? '저장 중...' : '입고일 확정'}
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
