import { Fragment, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { getBarcodeDataEntryShipments } from '@/lib/api'
import type { OutboundCompanyInFolder } from '@/lib/codes/outbound-partner'
import {
  barcodeDataEntryBackupEntries,
  barcodeDataEntryHistoryPartnerIds,
  barcodeDataEntryRowsFromHistory,
  groupBarcodeDataEntryHistory,
  isIsoDate,
  type BarcodeDataEntryHistoryJob,
  type BarcodeDataEntryHistoryLine,
} from '@/lib/outbound/barcode-outbound-data-entry'
import { cn, formatNumber } from '@/lib/utils'

function formatShippedOn(value: string) {
  const [year, month, day] = value.split('-')
  if (!year || !month || !day) return value
  return `${year}. ${month}. ${day}.`
}

function companyNameForKey(
  companies: readonly OutboundCompanyInFolder[],
  companyKey: string,
) {
  if (!companyKey) return '알 수 없는 업체'
  return (
    companies.find((company) => company.key === companyKey)?.groupName ||
    '알 수 없는 업체'
  )
}

function SummaryItem({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

type HistoryEditDraft = {
  key: string
  shippedOn: string
  note: string
  lines: BarcodeDataEntryHistoryLine[]
}

function draftFromJob(job: BarcodeDataEntryHistoryJob): HistoryEditDraft {
  return {
    key: job.key,
    shippedOn: job.shippedOn,
    note: job.note,
    lines: job.lines.map((line) => ({ ...line })),
  }
}

export type BarcodeDataEntryHistorySaveInput = {
  companyKey: string
  previousShippedOn: string
  shippedOn: string
  note: string
  partnerIds: string[]
  entries: ReturnType<typeof barcodeDataEntryBackupEntries>
}

/** 이 화면에서 백업한 출고 등록을 업체·출고일 단위로 보여 준다. */
export function BarcodeOutboundDataEntryHistoryPanel({
  brandId,
  companies,
  enabled,
  busy,
  onSave,
  onDelete,
}: {
  brandId: string
  companies: readonly OutboundCompanyInFolder[]
  enabled: boolean
  busy: boolean
  onSave: (input: BarcodeDataEntryHistorySaveInput) => Promise<void>
  onDelete: (job: BarcodeDataEntryHistoryJob) => Promise<void>
}) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<HistoryEditDraft | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const historyQuery = useQuery({
    queryKey: ['barcodeDataEntryShipments', brandId],
    queryFn: () => getBarcodeDataEntryShipments(brandId),
    enabled,
  })
  const jobs = useMemo(
    () => groupBarcodeDataEntryHistory(historyQuery.data ?? []),
    [historyQuery.data],
  )
  const companyCount = new Set(jobs.map((job) => job.companyKey)).size
  const kindTotal = jobs.reduce((sum, job) => sum + job.kinds, 0)
  const qtyTotal = jobs.reduce((sum, job) => sum + job.qty, 0)
  const error =
    historyQuery.error instanceof Error
      ? historyQuery.error.message
      : historyQuery.error
        ? '등록 이력을 불러오지 못했습니다.'
        : null

  function startEdit(job: BarcodeDataEntryHistoryJob) {
    setActionError(null)
    setEditDraft(draftFromJob(job))
    setOpenKey(job.key)
  }

  function updateLine(
    lineId: string,
    patch: Partial<Pick<BarcodeDataEntryHistoryLine, 'quantity'>>,
  ) {
    setEditDraft((current) =>
      current
        ? {
            ...current,
            lines: current.lines.map((line) =>
              line.id === lineId ? { ...line, ...patch } : line,
            ),
          }
        : current,
    )
  }

  async function saveEdit(job: BarcodeDataEntryHistoryJob) {
    if (!editDraft || editDraft.key !== job.key) return
    if (!isIsoDate(editDraft.shippedOn)) {
      setActionError('출고일을 확인하세요.')
      return
    }
    const entries = barcodeDataEntryBackupEntries(
      barcodeDataEntryRowsFromHistory(editDraft.lines),
    )
    if (entries.length === 0) {
      setActionError('수량이 없습니다. 등록을 지우려면 삭제를 누르세요.')
      return
    }
    const company = companies.find((item) => item.key === job.companyKey)
    setActionError(null)
    await onSave({
      companyKey: job.companyKey,
      previousShippedOn: job.shippedOn,
      shippedOn: editDraft.shippedOn,
      note: editDraft.note,
      partnerIds: barcodeDataEntryHistoryPartnerIds(
        { lines: editDraft.lines },
        company?.units.map((unit) => unit.id) ?? [],
      ),
      entries,
    })
    setEditDraft(null)
  }

  async function removeJob(job: BarcodeDataEntryHistoryJob) {
    const companyName = companyNameForKey(companies, job.companyKey)
    if (
      !window.confirm(
        `${companyName} ${formatShippedOn(job.shippedOn)} 등록 ${formatNumber(job.kinds)}종 ${formatNumber(job.qty)}개를 출고 백업에서 삭제할까요?`,
      )
    ) {
      return
    }
    setActionError(null)
    await onDelete(job)
    if (editDraft?.key === job.key) setEditDraft(null)
    if (openKey === job.key) setOpenKey(null)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>등록 이력</CardTitle>
          <CardDescription>
            이 화면에서 출고 데이터에 반영한 건만 봅니다. 수정·삭제는 출고
            백업도 같이 바꿉니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryItem
              label="등록"
              value={`${formatNumber(jobs.length)}회`}
            />
            <SummaryItem
              label="업체"
              value={`${formatNumber(companyCount)}곳`}
            />
            <SummaryItem
              label="종"
              value={`${formatNumber(kindTotal)}종`}
            />
            <SummaryItem
              label="개"
              value={`${formatNumber(qtyTotal)}개`}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>최근 등록</CardTitle>
          <CardDescription>
            줄을 열어 수량을 고치거나, 등록 전체를 삭제할 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {historyQuery.isPending ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              이력을 불러오는 중...
            </p>
          ) : error ? (
            <p className="py-10 text-center text-sm text-danger">{error}</p>
          ) : jobs.length > 0 ? (
            <div className="space-y-3">
              {actionError ? (
                <p className="text-sm text-danger">{actionError}</p>
              ) : null}
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-200 text-left text-xs">
                  <thead className="bg-muted/60">
                    <tr>
                      <th className="w-8 px-3 py-2.5" />
                      <th className="px-3 py-2.5 font-medium">출고일</th>
                      <th className="px-3 py-2.5 font-medium">업체</th>
                      <th className="px-3 py-2.5 text-right font-medium">종</th>
                      <th className="px-3 py-2.5 text-right font-medium">개</th>
                      <th className="px-3 py-2.5 font-medium">비고</th>
                      <th className="px-3 py-2.5 text-right font-medium">
                        작업
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => {
                      const editing =
                        editDraft?.key === job.key ? editDraft : null
                      const open = openKey === job.key || Boolean(editing)
                      const lines = editing?.lines ?? job.lines
                      return (
                        <Fragment key={job.key}>
                          <tr className="border-t border-border">
                            <td className="px-2 py-3">
                              <button
                                type="button"
                                className="rounded p-1 text-muted-foreground hover:bg-muted"
                                aria-expanded={open}
                                aria-label={`${companyNameForKey(companies, job.companyKey)} ${job.shippedOn} 상세`}
                                onClick={() =>
                                  setOpenKey(open && !editing ? null : job.key)
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
                              {editing ? (
                                <Input
                                  type="date"
                                  autoComplete="off"
                                  className="h-8 w-36"
                                  value={editing.shippedOn}
                                  disabled={busy}
                                  onChange={(event) =>
                                    setEditDraft((current) =>
                                      current
                                        ? {
                                            ...current,
                                            shippedOn: event.target.value,
                                          }
                                        : current,
                                    )
                                  }
                                />
                              ) : (
                                formatShippedOn(job.shippedOn)
                              )}
                            </td>
                            <td className="px-3 py-3 font-medium">
                              {companyNameForKey(companies, job.companyKey)}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums">
                              {formatNumber(job.kinds)}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums">
                              {formatNumber(
                                editing
                                  ? editing.lines.reduce(
                                      (sum, line) => sum + line.quantity,
                                      0,
                                    )
                                  : job.qty,
                              )}
                            </td>
                            <td className="max-w-72 px-3 py-3 text-muted-foreground">
                              {editing ? (
                                <Input
                                  value={editing.note}
                                  className="h-8"
                                  placeholder="비고"
                                  disabled={busy}
                                  onChange={(event) =>
                                    setEditDraft((current) =>
                                      current
                                        ? {
                                            ...current,
                                            note: event.target.value,
                                          }
                                        : current,
                                    )
                                  }
                                />
                              ) : (
                                <span className="block truncate">
                                  {job.note || '-'}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex justify-end gap-1.5">
                                {editing ? (
                                  <>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      disabled={busy}
                                      onClick={() => {
                                        setEditDraft(null)
                                        setActionError(null)
                                      }}
                                    >
                                      취소
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      disabled={busy}
                                      onClick={() => {
                                        void saveEdit(job).catch((reason) => {
                                          setActionError(
                                            reason instanceof Error
                                              ? reason.message
                                              : '수정하지 못했습니다.',
                                          )
                                        })
                                      }}
                                    >
                                      {busy ? '저장 중...' : '백업 수정'}
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      disabled={busy || Boolean(editDraft)}
                                      onClick={() => startEdit(job)}
                                    >
                                      수정
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="danger"
                                      disabled={busy || Boolean(editDraft)}
                                      onClick={() => {
                                        void removeJob(job).catch((reason) => {
                                          setActionError(
                                            reason instanceof Error
                                              ? reason.message
                                              : '삭제하지 못했습니다.',
                                          )
                                        })
                                      }}
                                    >
                                      삭제
                                    </Button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                          {open ? (
                            <tr className="border-t border-border bg-muted/30">
                              <td colSpan={7} className="px-3 py-3">
                                {lines.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">
                                    상세 행이 없습니다.
                                  </p>
                                ) : (
                                  <table className="w-full min-w-160 text-left text-xs">
                                    <thead>
                                      <tr className="text-muted-foreground">
                                        <th className="py-1.5 font-medium">
                                          M번호
                                        </th>
                                        <th className="py-1.5 font-medium">
                                          상품명
                                        </th>
                                        <th className="py-1.5 font-medium">
                                          지점
                                        </th>
                                        <th className="py-1.5 text-right font-medium">
                                          수량
                                        </th>
                                        {editing ? (
                                          <th className="w-16 py-1.5 text-right font-medium">
                                            행
                                          </th>
                                        ) : null}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {lines.map((line) => (
                                        <tr key={line.id}>
                                          <td className="py-1.5 font-medium">
                                            {line.styleNo || '-'}
                                          </td>
                                          <td className="py-1.5">
                                            {line.styleName || '-'}
                                          </td>
                                          <td className="py-1.5 text-muted-foreground">
                                            {line.partnerName || '-'}
                                          </td>
                                          <td className="py-1.5 text-right tabular-nums">
                                            {editing ? (
                                              <Input
                                                type="number"
                                                min={1}
                                                className="ml-auto h-8 w-24 text-right"
                                                value={
                                                  line.quantity > 0
                                                    ? line.quantity
                                                    : ''
                                                }
                                                disabled={busy}
                                                onChange={(event) => {
                                                  const parsed =
                                                    Number.parseInt(
                                                      event.target.value,
                                                      10,
                                                    )
                                                  updateLine(line.id, {
                                                    quantity:
                                                      Number.isFinite(parsed) &&
                                                      parsed > 0
                                                        ? parsed
                                                        : 0,
                                                  })
                                                }}
                                              />
                                            ) : (
                                              formatNumber(line.quantity)
                                            )}
                                          </td>
                                          {editing ? (
                                            <td className="py-1.5 text-right">
                                              <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                disabled={busy}
                                                onClick={() =>
                                                  setEditDraft((current) =>
                                                    current
                                                      ? {
                                                          ...current,
                                                          lines:
                                                            current.lines.filter(
                                                              (item) =>
                                                                item.id !==
                                                                line.id,
                                                            ),
                                                        }
                                                      : current,
                                                  )
                                                }
                                              >
                                                빼기
                                              </Button>
                                            </td>
                                          ) : null}
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
            </div>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
              <History className="size-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">
                아직 등록한 이력이 없습니다.
              </p>
              <p className="mt-1 max-w-lg text-xs leading-5 text-muted-foreground">
                데이터 입력 탭에서 연결을 마치고 출고 데이터에 반영하면 여기에
                남습니다. 같은 업체·출고일을 다시 반영하면 그 등록이
                바뀝니다.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
