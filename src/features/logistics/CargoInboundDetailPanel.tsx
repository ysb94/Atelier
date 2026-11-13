import { Fragment, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  MapPin,
  MessageSquareText,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatGrid, StatTile } from '@/components/ui/stat-tile'
import { getCargoInboundReceipts, type CargoInboundTidySlotInput } from '@/lib/api'
import { CargoInboundRequestDialog } from '@/features/logistics/CargoInboundRequestDialog'
import { CargoInspectionButton } from '@/features/logistics/CargoInspectionDialog'
import { CargoWarehouseTidyButton } from '@/features/logistics/CargoUnloadListDialog'
import { CargoWarehouseSlotDialog } from '@/features/logistics/CargoWarehouseSlotDialog'
import { formatCargoInboundTitle } from '@/features/logistics/cargo-inbound-title'
import { summarizeCargoInboundReceipts, type CargoInboundLineDraft } from '@/lib/cargo/inbound'
import type { CargoLineListValues } from '@/lib/cargo/line-list'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAuth } from '@/lib/supabase/auth'
import { formatNumber } from '@/lib/utils'
import { brandQueryKey } from '@/lib/workspace/query-keys'

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
  warehouseSummary: string
  tidySavedAt: string | null
  lines: CargoInboundLineDraft[]
}

type CargoInboundDetailPanelProps = {
  item: CargoInboundDetailItem
  deleting?: boolean
  onBack: () => void
  onDelete: () => void
  onSaveInboundDate: (inboundDate: string, note: string) => Promise<void>
  onComplete: (inboundDate: string, note: string) => Promise<void>
  onSaveRequestNotes: (
    notes: Array<{ lineId: string; requestNote: string }>,
  ) => Promise<void>
  onSaveTidyRows: (rows: readonly CargoLineListValues[]) => Promise<void>
  onSaveTidySlots: (
    slots: readonly CargoInboundTidySlotInput[],
    complete: boolean,
  ) => Promise<void>
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
  deleting = false,
  onBack,
  onDelete,
  onSaveInboundDate,
  onComplete,
  onSaveRequestNotes,
  onSaveTidyRows,
  onSaveTidySlots,
}: CargoInboundDetailPanelProps) {
  useRenderWatch('CargoInboundDetailPanel')
  const tabActive = useWorkspaceTabActivity()
  const { session } = useAuth()
  const viewerId = session?.user.id
  const lineIds = useMemo(() => item.lines.map(line => line.id), [item.lines])
  const receiptsQuery = useQuery({
    queryKey: brandQueryKey('cargo-inbound-receipts', item.brandId, item.id, viewerId, lineIds),
    queryFn: ({ signal }) => getCargoInboundReceipts(item.brandId, lineIds, signal),
    enabled: tabActive && Boolean(viewerId) && lineIds.length > 0,
    staleTime: 15_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  })
  const receiptData = receiptsQuery.data
  const receiptSummary = useMemo(
    () => receiptData?.ready ? summarizeCargoInboundReceipts(receiptData.receipts) : null,
    [receiptData],
  )
  const title = formatCargoInboundTitle(item.shippedAt, item.boxCount)
  const [inboundDateEdit, setInboundDateEdit] = useState<string>()
  const [noteEdit, setNoteEdit] = useState<string>()
  const inboundDate = inboundDateEdit ?? item.scheduledInboundAt ?? ''
  const note = noteEdit ?? item.portContactNote ?? ''
  const [status, setStatus] = useState<string | null>(null)
  const [statusWarning, setStatusWarning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
  const [slotOpen, setSlotOpen] = useState(false)
  const inboundDateRef = useRef<HTMLInputElement>(null)
  const done = item.stage === 'done'
  const busy = saving || completing || deleting

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
      setStatusWarning(false)
      setStatus(
        error instanceof Error ? error.message : '입고일 저장에 실패했습니다.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function completeCargo() {
    if (busy || done) return
    if (!inboundDate) {
      setStatusWarning(true)
      setStatus('입고일을 입력한 뒤 완료를 눌러 주세요.')
      inboundDateRef.current?.focus()
      return
    }
    if (!window.confirm(
      `창고자리 입력을 건너뛰고 입고일 ${formatDate(inboundDate)}로 완료할까요?`,
    )) return

    setCompleting(true)
    setStatus(null)
    try {
      await onComplete(inboundDate, note)
    } catch (error) {
      setStatusWarning(true)
      setStatus(error instanceof Error ? error.message : '화물 완료 처리에 실패했습니다.')
    } finally {
      setCompleting(false)
    }
  }

  function openWarehouseTidy() {
    setStatusWarning(false)
    setStatus(null)
    return true
  }

  function openRequests() {
    if (item.tidySavedAt) {
      const proceed = window.confirm(
        '기존 창고정리용 저장 목록이 있습니다. 요청 사항을 저장한 뒤 「이전 저장 목록」에서 「현재 요청 사항만 불러오기」를 누르면 반영됩니다. 그래도 열까요?',
      )
      if (!proceed) return
    }
    setRequestOpen(true)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onBack}>
              <ArrowLeft className="size-3.5" />
              목록으로
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="text-danger hover:bg-danger/10"
              disabled={busy}
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
              {deleting ? '삭제 중' : '삭제'}
            </Button>
          </div>
          {item.stage === 'scheduled' || item.stage === 'done' ? (
            <div className="flex flex-wrap gap-2">
              <CargoInspectionButton
                title={title}
                brandName={item.brandName}
                lines={item.lines}
              />
              <CargoWarehouseTidyButton
                title={title}
                brandId={item.brandId}
                brandName={item.brandName}
                shippedAt={item.shippedAt}
                lines={item.lines}
                shipmentId={item.id}
                stage={item.stage}
                tidySavedAt={item.tidySavedAt}
                incomingOnlyPreview
                beforeOpen={openWarehouseTidy}
              />
              {item.tidySavedAt && <CargoWarehouseTidyButton
                title={title}
                brandId={item.brandId}
                brandName={item.brandName}
                shippedAt={item.shippedAt}
                lines={item.lines}
                shipmentId={item.id}
                stage={item.stage}
                tidySavedAt={item.tidySavedAt}
                buttonLabel="이전 저장 목록"
                onSaveRows={async (rows) => {
                  await onSaveTidyRows(rows)
                  setStatusWarning(false)
                  setStatus(null)
                }}
              />}
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
              {done ? (
                <Badge variant="success">물류 완료</Badge>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              선적일 {formatDate(item.shippedAt)} · 상품 {formatNumber(item.productCount)}종
              {item.totalQty > 0
                ? ` · 예정 낱개 ${formatNumber(item.totalQty)}개`
                : ''}
              {done && item.warehouseSummary ? ` · ${item.warehouseSummary}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={openRequests}
            >
              <MessageSquareText className="size-3.5" />
              요청 사항
            </Button>
            {item.stage === 'scheduled' && item.tidySavedAt ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setStatus(null)
                  setSlotOpen(true)
                }}
              >
                <MapPin className="size-3.5" />
                창고자리 입력
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              disabled={busy || done}
              onClick={() => void completeCargo()}
            >
              <CheckCircle2 className="size-3.5" />
              {done ? '완료됨' : completing ? '완료 처리 중...' : '완료'}
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-2" role="group" aria-label="화물 박스 집계">
        <StatGrid className="mb-0 sm:grid-cols-3 xl:grid-cols-3">
          <StatTile label="예정 박스 수" value={`${formatNumber(item.boxCount)}박스`} />
          <StatTile
            label="QR 연결 박스 수"
            value={receiptSummary || !lineIds.length ? `${formatNumber(receiptSummary?.linkedBoxes ?? 0)}박스` : '—'}
          />
          <StatTile
            label="입고 완료 박스 수"
            value={receiptSummary || !lineIds.length ? `${formatNumber(receiptSummary?.receivedBoxes ?? 0)}박스` : '—'}
            hint={receiptSummary ? `실제 입고 낱개 ${formatNumber(receiptSummary.receivedQty)}개` : undefined}
          />
        </StatGrid>
        {lineIds.length > 0 ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {receiptsQuery.isError ? (
              <p className="mr-auto text-xs text-danger" role="alert">
                {receiptSummary
                  ? 'Finder 입고 내역을 갱신하지 못했습니다. 마지막 조회 결과를 표시합니다.'
                  : receiptsQuery.error.message}
              </p>
            ) : receiptData?.ready === false ? (
              <p className="mr-auto text-xs text-muted-foreground" role="status">
                Finder 입고 내역 서버 연결 대기
              </p>
            ) : receiptsQuery.isLoading ? (
              <p className="mr-auto text-xs text-muted-foreground" role="status">
                Finder 입고 내역을 불러오는 중입니다.
              </p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!viewerId || receiptsQuery.isFetching}
              onClick={() => void receiptsQuery.refetch()}
            >
              <RefreshCw className="size-3.5" />
              입고 내역 새로고침
            </Button>
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
            ref={inboundDateRef}
            type="date"
            value={inboundDate}
            disabled={busy || done}
            onChange={(event) => setInboundDateEdit(event.target.value)}
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            항구 협의 메모
          </span>
          <Input
            value={note}
            placeholder="예: 오전 입고 / 오후 2시 이후"
            disabled={busy || done}
            onChange={(event) => setNoteEdit(event.target.value)}
          />
        </label>
        <div className="flex items-end">
          <Button
            type="button"
            className="w-full md:w-auto"
            disabled={!inboundDate || busy || done}
            onClick={() => void saveInboundDate()}
          >
            {saving ? '저장 중...' : '입고일 확정'}
          </Button>
        </div>
      </div>

      {status ? (
        <p
          className={
            statusWarning
              ? 'text-xs text-warning'
              : 'text-xs text-muted-foreground'
          }
          role={statusWarning ? 'alert' : 'status'}
        >
          {status}
        </p>
      ) : null}

      {item.lines.length === 0 ? (
        <p className="rounded-lg border border-border px-4 py-10 text-center text-sm text-muted-foreground">
          등록된 상품 상세가 없습니다.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="bg-primary text-xs text-primary-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">NO</th>
                <th className="px-3 py-2 font-medium">품명</th>
                <th className="px-3 py-2 font-medium">사진</th>
                <th className="px-3 py-2 font-medium">M번호</th>
                <th className="px-3 py-2 text-right font-medium">예정 낱개</th>
                <th className="px-3 py-2 text-right font-medium">실제 입고 낱개</th>
                <th className="px-3 py-2 text-right font-medium">박스 당</th>
                <th className="px-3 py-2 text-right font-medium">박스</th>
                <th className="px-3 py-2 font-medium">비고</th>
              </tr>
            </thead>
            <tbody>
              {item.lines.map((line, index) => {
                const inbound = receiptSummary?.byLine.get(line.id)
                return (
                  <Fragment key={line.id}>
                    <tr className="border-t border-border">
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
                      <td className="px-3 py-2 text-right tabular-nums">
                        {receiptSummary ? `${formatNumber(inbound?.receivedQty ?? 0)}개` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">{line.perBox || '-'}</td>
                      <td className="px-3 py-2 text-right">{line.boxes || '-'}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {line.note || '-'}
                      </td>
                    </tr>
                    {inbound?.receipts.length ? (
                      <tr className="bg-muted/35">
                        <td colSpan={9} className="px-6 py-2">
                          <ul className="space-y-1.5" aria-label={`${line.name || line.styleNo || '품목'} 입고 내역`}>
                            {inbound.receipts.map(receipt => {
                              const locationOnly = receipt.mode === 'location_only'
                              const received = Boolean(receipt.receivedAt)
                              const badge = <Badge variant={received ? 'success' : 'muted'}>
                                {received ? '입고 완료' : '입고 대기'}
                              </Badge>
                              return (
                                <li
                                  key={receipt.id}
                                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
                                >
                                  {locationOnly ? badge : <span className="font-mono break-all">{receipt.boxQr}</span>}
                                  {locationOnly ? <span>{formatNumber(receipt.actualBoxCount)}박스</span> : null}
                                  <span className="tabular-nums">{formatNumber(receipt.actualQty)}개</span>
                                  {locationOnly ? null : badge}
                                  {received && receipt.receivedLocationCode ? (
                                    <span className="text-muted-foreground">
                                      <span className="sr-only">입고 당시 자리 </span>
                                      {receipt.receivedLocationCode}
                                    </span>
                                  ) : null}
                                </li>
                              )
                            })}
                          </ul>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {requestOpen ? (
        <CargoInboundRequestDialog
          title={title}
          brandName={item.brandName}
          lines={item.lines}
          onClose={() => setRequestOpen(false)}
          onSave={onSaveRequestNotes}
        />
      ) : null}
      {slotOpen ? (
        <CargoWarehouseSlotDialog
          title={title}
          brandId={item.brandId}
          brandName={item.brandName}
          shipmentId={item.id}
          onClose={() => setSlotOpen(false)}
          onSave={onSaveTidySlots}
        />
      ) : null}
    </div>
  )
}
