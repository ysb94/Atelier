import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, CalendarDays, ClipboardCheck, MessageSquareText, X } from 'lucide-react'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CargoStockCheckButton } from '@/features/logistics/CargoStockCheckDialog'
import {
  CargoUnloadListButton,
  CargoWarehouseTidyButton,
} from '@/features/logistics/CargoUnloadListDialog'
import { formatCargoInboundTitle } from '@/features/logistics/cargo-inbound-title'
import type { CargoInboundLineDraft } from '@/lib/cargo/inbound'
import { formatNumber } from '@/lib/utils'

export type CargoInboundDetailItem = {
  id: string
  brandId: string
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

function CargoInboundRequestDialog({
  title,
  onClose,
}: {
  title: string
  onClose: () => void
}) {
  return createPortal(
    <WorkspaceTabOverlay>
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <button
          type="button"
          aria-label="요청 사항 닫기"
          className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
          onClick={onClose}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cargo-inbound-request-title"
          className="relative z-10 flex max-h-[min(36rem,calc(100vh-2rem))] w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-lg"
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose()
          }}
        >
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h3
                id="cargo-inbound-request-title"
                className="text-base font-semibold tracking-tight"
              >
                요청 사항
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{title}</p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="요청 사항 닫기"
              onClick={onClose}
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="min-h-40 flex-1 px-4 py-8 text-center text-sm text-muted-foreground">
            등록된 요청 사항이 없습니다.
          </div>
          <div className="flex justify-end border-t border-border px-4 py-3">
            <Button type="button" size="sm" variant="outline" onClick={onClose}>
              닫기
            </Button>
          </div>
        </div>
      </div>
    </WorkspaceTabOverlay>,
    document.body,
  )
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
  const [requestOpen, setRequestOpen] = useState(false)

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
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" size="sm" variant="outline" onClick={onBack}>
            <ArrowLeft className="size-3.5" />
            목록으로
          </Button>
          {item.stage === 'scheduled' || item.stage === 'done' ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline">
                <ClipboardCheck className="size-3.5" />
                검수용
              </Button>
              <CargoStockCheckButton
                title={title}
                brandId={item.brandId}
                lines={item.lines}
              />
              <CargoUnloadListButton
                title={title}
                brandId={item.brandId}
                brandName={item.brandName}
                shippedAt={item.shippedAt}
                lines={item.lines}
              />
              <CargoWarehouseTidyButton
                title={title}
                brandId={item.brandId}
                brandName={item.brandName}
                shippedAt={item.shippedAt}
                lines={item.lines}
              />
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
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
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setRequestOpen(true)}
          >
            <MessageSquareText className="size-3.5" />
            요청 사항
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

      {requestOpen ? (
        <CargoInboundRequestDialog
          title={title}
          onClose={() => setRequestOpen(false)}
        />
      ) : null}
    </div>
  )
}
