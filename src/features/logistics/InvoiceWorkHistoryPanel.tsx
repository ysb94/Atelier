import { Fragment, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, History, Pencil, Trash2 } from 'lucide-react'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tabs'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  countInvoiceOutboundForFingerprint,
  deleteInvoiceWorkRun,
  getInvoiceWorkRuns,
  updateInvoiceWorkRun,
} from '@/lib/api'
import { PRODUCT_OUTBOUND_UPDATED_EVENT } from '@/lib/outbound/product-outbound'
import type { InvoiceWorkRun } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

function formatWorkedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function toDateTimeLocal(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromDateTimeLocal(value: string): string | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function SummaryItem({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'success' | 'warning' | 'danger'
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <p
        className={cn(
          'text-2xl font-semibold tabular-nums',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning',
          tone === 'danger' && 'text-danger',
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function InvoiceWorkRunEditDialog({
  item,
  saving,
  error,
  onClose,
  onSave,
}: {
  item: InvoiceWorkRun
  saving: boolean
  error: string | null
  onClose: () => void
  onSave: (input: {
    sourceFileName: string
    workerLabel: string
    completedAt: string
  }) => void
}) {
  const [sourceFileName, setSourceFileName] = useState(item.sourceFileName)
  const [workerLabel, setWorkerLabel] = useState(item.workerLabel)
  const [completedAt, setCompletedAt] = useState(
    toDateTimeLocal(item.completedAt),
  )

  return (
    <WorkspaceTabOverlay>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button
          type="button"
          className="absolute inset-0 bg-black/40"
          aria-label="닫기"
          disabled={saving}
          onClick={() => {
            if (saving) return
            onClose()
          }}
        />
        <div
          role="dialog"
          aria-modal="true"
          className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg"
        >
          <h2 className="text-base font-semibold">작업 이력 수정</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            파일명·작업자·작업 시각만 고칩니다. 출고 수량과 사이트 집계는
            그대로 둡니다.
          </p>
          <label className="mt-4 block space-y-1 text-sm">
            <span className="text-muted-foreground">원본 파일</span>
            <Input
              value={sourceFileName}
              disabled={saving}
              autoComplete="off"
              onChange={(event) => setSourceFileName(event.target.value)}
            />
          </label>
          <label className="mt-3 block space-y-1 text-sm">
            <span className="text-muted-foreground">작업자</span>
            <Input
              value={workerLabel}
              disabled={saving}
              autoComplete="off"
              onChange={(event) => setWorkerLabel(event.target.value)}
            />
          </label>
          <label className="mt-3 block space-y-1 text-sm">
            <span className="text-muted-foreground">작업 시각</span>
            <Input
              type="datetime-local"
              value={completedAt}
              disabled={saving}
              onChange={(event) => setCompletedAt(event.target.value)}
            />
          </label>
          {error ? (
            <p className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={onClose}
            >
              취소
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saving || !completedAt}
              onClick={() => {
                const nextCompletedAt = fromDateTimeLocal(completedAt)
                if (!nextCompletedAt) return
                onSave({
                  sourceFileName: sourceFileName.trim(),
                  workerLabel: workerLabel.trim(),
                  completedAt: nextCompletedAt,
                })
              }}
            >
              {saving ? '저장 중...' : '저장'}
            </Button>
          </div>
        </div>
      </div>
    </WorkspaceTabOverlay>
  )
}

function InvoiceWorkRunDeleteDialog({
  item,
  backup,
  saving,
  error,
  onClose,
  onConfirm,
}: {
  item: InvoiceWorkRun
  backup: { kinds: number; quantity: number } | null
  saving: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}) {
  const [acknowledged, setAcknowledged] = useState(false)

  return (
    <WorkspaceTabOverlay>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button
          type="button"
          className="absolute inset-0 bg-black/40"
          aria-label="닫기"
          disabled={saving}
          onClick={() => {
            if (saving) return
            onClose()
          }}
        />
        <div
          role="dialog"
          aria-modal="true"
          className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg"
        >
          <h2 className="text-base font-semibold text-danger">작업 이력 삭제</h2>
          <p className="mt-2 text-sm">
            <span className="font-medium">
              「{item.sourceFileName || '(파일명 없음)'}」
            </span>{' '}
            작업을 삭제합니다.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            최근 작업 기록과, 이 파일로 백업한 출고 데이터를 함께 지웁니다.
            되돌릴 수 없습니다.
          </p>
          <p className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {backup == null
              ? '출고 데이터를 확인하는 중…'
              : backup.kinds === 0
                ? '이 작업으로 저장된 출고 데이터는 없습니다. 이력만 삭제됩니다.'
                : `출고 데이터 ${formatNumber(backup.kinds)}종 · ${formatNumber(backup.quantity)}개가 함께 삭제됩니다.`}
          </p>
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={acknowledged}
              disabled={saving}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>삭제되는 내용을 확인했습니다.</span>
          </label>
          {error ? (
            <p className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={onClose}
            >
              취소
            </Button>
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={!acknowledged || saving || backup == null}
              onClick={onConfirm}
            >
              {saving ? '삭제 중…' : '삭제'}
            </Button>
          </div>
        </div>
      </div>
    </WorkspaceTabOverlay>
  )
}

/** 송장작업 완료 이력·사이트별 출고 수량. 개인정보는 없다. */
export function InvoiceWorkHistoryPanel({ brandId }: { brandId: string }) {
  const queryClient = useQueryClient()
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<InvoiceWorkRun | null>(null)
  const [deleting, setDeleting] = useState<InvoiceWorkRun | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [deleteSaving, setDeleteSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteBackup, setDeleteBackup] = useState<{
    kinds: number
    quantity: number
  } | null>(null)
  const historyQuery = useQuery({
    queryKey: ['invoiceWorkRuns', brandId],
    queryFn: () => getInvoiceWorkRuns(brandId),
  })
  const history = historyQuery.data ?? []
  const exportedRows = history.reduce(
    (total, item) => total + item.exportedRowCount,
    0,
  )
  const orderCount = history.reduce(
    (total, item) => total + item.sourceOrderCount,
    0,
  )
  const reviewRows = history.reduce(
    (total, item) => total + item.reviewRowCount,
    0,
  )
  const error =
    historyQuery.error instanceof Error
      ? historyQuery.error.message
      : historyQuery.error
        ? '작업 이력을 불러오지 못했습니다.'
        : null

  useEffect(() => {
    if (!deleting) {
      setDeleteBackup(null)
      return
    }
    let cancelled = false
    setDeleteBackup(null)
    void countInvoiceOutboundForFingerprint(
      brandId,
      deleting.fileFingerprint,
    )
      .then((backup) => {
        if (!cancelled) setDeleteBackup(backup)
      })
      .catch((reason) => {
        if (cancelled) return
        setDeleteBackup({ kinds: 0, quantity: 0 })
        setDeleteError(
          reason instanceof Error
            ? reason.message
            : '출고 데이터를 확인하지 못했습니다.',
        )
      })
    return () => {
      cancelled = true
    }
  }, [brandId, deleting])

  function notifyOutboundUpdated() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent(PRODUCT_OUTBOUND_UPDATED_EVENT, {
        detail: { brandId },
      }),
    )
  }

  async function saveEdit(input: {
    sourceFileName: string
    workerLabel: string
    completedAt: string
  }) {
    if (!editing) return
    setEditSaving(true)
    setEditError(null)
    try {
      await updateInvoiceWorkRun({
        brandId,
        runId: editing.id,
        sourceFileName: input.sourceFileName,
        workerLabel: input.workerLabel,
        completedAt: input.completedAt,
      })
      await queryClient.invalidateQueries({
        queryKey: ['invoiceWorkRuns', brandId],
      })
      setEditing(null)
    } catch (reason) {
      setEditError(
        reason instanceof Error
          ? reason.message
          : '작업 이력을 수정하지 못했습니다.',
      )
    } finally {
      setEditSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setDeleteSaving(true)
    setDeleteError(null)
    try {
      await deleteInvoiceWorkRun({
        brandId,
        runId: deleting.id,
      })
      notifyOutboundUpdated()
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['invoiceWorkRuns', brandId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['outboundShipments', brandId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['invoiceBackedUpOrderKeys', brandId],
        }),
      ])
      if (openId === deleting.id) setOpenId(null)
      setDeleting(null)
    } catch (reason) {
      setDeleteError(
        reason instanceof Error
          ? reason.message
          : '작업 이력을 삭제하지 못했습니다.',
      )
    } finally {
      setDeleteSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card className="shadow-none">
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>작업 이력</CardTitle>
            <CardDescription className="mt-1">
              어떤 파일을 누가 변환했고, 사이트별로 몇 건이 나갔는지
              확인합니다. 같은 파일은 한 작업으로 갱신됩니다.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryItem
              label="표시된 변환"
              value={`${formatNumber(history.length)}회`}
            />
            <SummaryItem
              label="주문 건수"
              value={`${formatNumber(orderCount)}건`}
            />
            <SummaryItem
              label="CJ 출력"
              value={`${formatNumber(exportedRows)}행`}
              tone="success"
            />
            <SummaryItem
              label="확인 필요"
              value={`${formatNumber(reviewRows)}행`}
              tone="danger"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>최근 작업</CardTitle>
          <CardDescription>
            고객정보 대신 작업 단위와 사이트별 출고 수량만 보여 줍니다.
            백업하거나 CJ 13열을 내려받으면 남고, 여기서 수정·삭제할 수
            있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {historyQuery.isPending ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              이력을 불러오는 중...
            </p>
          ) : error ? (
            <p className="py-10 text-center text-sm text-danger">{error}</p>
          ) : history.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-200 text-left text-xs">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="w-8 px-3 py-2.5" />
                    <th className="px-3 py-2.5 font-medium">작업 시각</th>
                    <th className="px-3 py-2.5 font-medium">원본 파일</th>
                    <th className="px-3 py-2.5 font-medium">작업자</th>
                    <th className="px-3 py-2.5 text-right font-medium">원본</th>
                    <th className="px-3 py-2.5 text-right font-medium">주문</th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      CJ 출력
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      확인 필요
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => {
                    const open = openId === item.id
                    return (
                      <Fragment key={item.id}>
                        <tr className="border-t border-border">
                          <td className="px-2 py-3">
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground hover:bg-muted"
                              aria-expanded={open}
                              onClick={() =>
                                setOpenId(open ? null : item.id)
                              }
                            >
                              <ChevronDown
                                className={cn(
                                  'size-4 transition-transform',
                                  open && 'rotate-180',
                                )}
                              />
                            </button>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                            {formatWorkedAt(item.completedAt)}
                          </td>
                          <td className="max-w-72 px-3 py-3 font-medium">
                            {item.sourceFileName || '(파일명 없음)'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">
                            {item.workerLabel || '-'}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            {formatNumber(item.sourceRowCount)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            {formatNumber(item.sourceOrderCount)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-success">
                            {formatNumber(item.exportedRowCount)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-danger">
                            {formatNumber(item.reviewRowCount)}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex justify-end gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditError(null)
                                  setEditing(item)
                                }}
                              >
                                <Pencil className="size-3.5" />
                                수정
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="text-danger"
                                onClick={() => {
                                  setDeleteError(null)
                                  setDeleting(item)
                                }}
                              >
                                <Trash2 className="size-3.5" />
                                삭제
                              </Button>
                            </div>
                          </td>
                        </tr>
                        {open ? (
                          <tr className="border-t border-border bg-muted/30">
                            <td colSpan={9} className="px-3 py-3">
                              {item.sites.length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                  사이트 집계가 없습니다.
                                </p>
                              ) : (
                                <table className="w-full min-w-160 text-left text-xs">
                                  <thead>
                                    <tr className="text-muted-foreground">
                                      <th className="py-1.5 font-medium">
                                        사이트
                                      </th>
                                      <th className="py-1.5 font-medium">
                                        원본 표기
                                      </th>
                                      <th className="py-1.5 text-right font-medium">
                                        주문
                                      </th>
                                      <th className="py-1.5 text-right font-medium">
                                        원본 수량
                                      </th>
                                      <th className="py-1.5 text-right font-medium">
                                        CJ 주문
                                      </th>
                                      <th className="py-1.5 text-right font-medium">
                                        사은품
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {item.sites.map((site) => (
                                      <tr key={site.id}>
                                        <td className="py-1.5 font-medium">
                                          {site.targetName}
                                        </td>
                                        <td className="py-1.5 text-muted-foreground">
                                          {site.sourceMallNames || '-'}
                                        </td>
                                        <td className="py-1.5 text-right tabular-nums">
                                          {formatNumber(site.orderCount)}
                                        </td>
                                        <td className="py-1.5 text-right tabular-nums">
                                          {formatNumber(site.sourceQuantity)}
                                        </td>
                                        <td className="py-1.5 text-right tabular-nums">
                                          {formatNumber(site.cjOrderQuantity)}
                                        </td>
                                        <td className="py-1.5 text-right tabular-nums">
                                          {formatNumber(site.cjGiftQuantity)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
              <History className="size-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">
                아직 기록된 송장작업이 없습니다.
              </p>
              <p className="mt-1 max-w-lg text-xs leading-5 text-muted-foreground">
                출고반영에서 백업하거나 CJ 13열을 내려받으면 파일명·작업자·사이트별
                주문·출고 수량이 남습니다. 수령인 정보는 저장하지 않습니다.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {editing ? (
        <InvoiceWorkRunEditDialog
          item={editing}
          saving={editSaving}
          error={editError}
          onClose={() => {
            if (editSaving) return
            setEditing(null)
          }}
          onSave={(input) => {
            void saveEdit(input)
          }}
        />
      ) : null}

      {deleting ? (
        <InvoiceWorkRunDeleteDialog
          item={deleting}
          backup={deleteBackup}
          saving={deleteSaving}
          error={deleteError}
          onClose={() => {
            if (deleteSaving) return
            setDeleting(null)
          }}
          onConfirm={() => {
            void confirmDelete()
          }}
        />
      ) : null}
    </div>
  )
}
