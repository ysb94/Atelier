import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Download, FileText, ImageOff } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { getCompanyProductDrafts, updateProductDraft } from '@/lib/api'
import { DEFAULT_COMPANY_ID } from '@/lib/company/capabilities'
import {
  draftHasSampleWorkOrder,
  draftToInput,
  filledSampleWorkOrders,
  legacyWorkOrderFields,
  previousSampleFailReason,
  setSampleWorkOrderShipped,
} from '@/lib/drafts/sample-work-order'
import { useAuth } from '@/lib/supabase/auth'
import type { ProductDraft } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'

function sampleInProgressCount(draft: ProductDraft) {
  return draft.colors.filter((color) => color.sampleInProgress).length
}

type WorkOrderTab = 'open' | 'done'

const WORK_ORDER_TABS: { value: WorkOrderTab; label: string }[] = [
  { value: 'open', label: '진행중' },
  { value: 'done', label: '종료' },
]

function workOrderFileName(name: string) {
  return name.trim() || '샘플 작업 지시서'
}

function isWorkOrderDone(order: { shipped?: boolean; passed?: boolean }) {
  return Boolean(order.shipped || order.passed)
}

function formatSavedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function CompanySampleWorkOrderPage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [listTab, setListTab] = useState<WorkOrderTab>('open')
  const companyId = profile?.companyId ?? DEFAULT_COMPANY_ID

  const draftsQuery = useQuery({
    queryKey: ['product-drafts', 'company', companyId],
    queryFn: () => getCompanyProductDrafts(companyId),
  })

  const shipMutation = useMutation({
    mutationFn: async ({
      draft,
      orderId,
    }: {
      draft: ProductDraft
      orderId: string
    }) => {
      const input = draftToInput(draft)
      const sampleWorkOrders = setSampleWorkOrderShipped(
        input.sampleWorkOrders,
        orderId,
        true,
      )
      return updateProductDraft(draft.id, {
        ...input,
        sampleWorkOrders,
        ...legacyWorkOrderFields(sampleWorkOrders),
      })
    },
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['product-drafts', 'company', companyId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['product-draft', updated.id],
        }),
      ])
    },
  })

  const workOrders = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return (draftsQuery.data ?? [])
      .filter((draft) => draftHasSampleWorkOrder(draft))
      .flatMap((draft) =>
        filledSampleWorkOrders(draft.sampleWorkOrders).map((order) => ({
          draft,
          order,
        })),
      )
      .filter(({ draft, order }) => {
        if (!keyword) return true
        return [
          draft.draftNo,
          draft.nameKo,
          draft.nameEn,
          draft.owner,
          order.name,
          ...draft.colors.map((color) => color.name),
        ]
          .filter(Boolean)
          .some((text) => text.toLowerCase().includes(keyword))
      })
      .sort((left, right) => {
        const byTime = right.draft.updatedAt.localeCompare(left.draft.updatedAt)
        if (byTime !== 0) return byTime
        return right.order.round - left.order.round
      })
  }, [draftsQuery.data, search])

  const tabCounts = useMemo(
    () => ({
      open: workOrders.filter(({ order }) => !isWorkOrderDone(order)).length,
      done: workOrders.filter(({ order }) => isWorkOrderDone(order)).length,
    }),
    [workOrders],
  )
  const visibleWorkOrders = useMemo(
    () =>
      workOrders.filter(({ order }) =>
        listTab === 'done' ? isWorkOrderDone(order) : !isWorkOrderDone(order),
      ),
    [listTab, workOrders],
  )

  return (
    <div>
      <PageHeader
        title="작업 지시서"
        description="기획에서 올리고 저장한 샘플 작업 지시서입니다. 다음 지시서를 올리면 새 행이 생기고, 이미 발송한 행은 그대로 완료로 남습니다."
      />

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          className="sm:max-w-xs"
          placeholder="PL번호, 이름, 파일명, 컬러 검색..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="text-sm text-muted-foreground sm:ml-auto">
          {formatNumber(visibleWorkOrders.length)}건
        </div>
      </div>

      <div
        role="tablist"
        aria-label="작업 지시서 상태"
        className="mb-4 flex items-stretch gap-0.5 border-b border-border"
      >
        {WORK_ORDER_TABS.map((item) => {
          const selected = item.value === listTab
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setListTab(item.value)}
              className={cn(
                '-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors',
                selected
                  ? 'border-foreground font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {item.label} {formatNumber(tabCounts[item.value])}
            </button>
          )
        })}
      </div>

      {draftsQuery.isError ? (
        <p className="mb-3 text-sm text-danger">
          작업 지시서를 불러오지 못했습니다.
        </p>
      ) : null}
      {shipMutation.isError ? (
        <p className="mb-3 text-sm text-danger">
          발송 완료를 저장하지 못했습니다.
        </p>
      ) : null}

      {draftsQuery.isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          불러오는 중...
        </p>
      ) : workOrders.length === 0 ? (
        <Card className="px-4 py-10 text-center text-sm text-muted-foreground">
          {search.trim()
            ? '조건에 맞는 작업 지시서가 없습니다.'
            : '기획안에서 샘플 작업 지시서를 올리고 저장하면 여기에 나타납니다.'}
        </Card>
      ) : visibleWorkOrders.length === 0 ? (
        <Card className="px-4 py-10 text-center text-sm text-muted-foreground">
          {listTab === 'open'
            ? '진행 중인 작업 지시서가 없습니다.'
            : '종료된 작업 지시서가 없습니다.'}
        </Card>
      ) : (
        <div className="space-y-2">
          {visibleWorkOrders.map(({ draft, order }) => {
            const namedColors = draft.colors.filter((color) =>
              color.name.trim(),
            )
            const sampleCount = sampleInProgressCount(draft)
            const done = order.shipped || order.passed
            const fileName = workOrderFileName(order.name)
            const failReason = order.failReason?.trim() ?? ''
            const focusReason = previousSampleFailReason(
              draft.sampleWorkOrders,
              order.id,
            )
            const note = done ? failReason : focusReason
            const shippingThis =
              shipMutation.isPending &&
              shipMutation.variables?.orderId === order.id
            return (
              <Card
                key={`${draft.id}:${order.id}`}
                className="flex flex-col gap-3 p-3"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
                    {draft.imageUrl ? (
                      <img
                        src={draft.imageUrl}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : (
                      <ImageOff className="size-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs tabular-nums text-muted-foreground">
                      {draft.draftNo}
                    </div>
                    <div className="truncate font-medium">
                      {draft.nameKo || draft.nameEn || '이름 미정'}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {namedColors.length === 0
                        ? '컬러 미정'
                        : namedColors
                            .map((color) => color.name.trim())
                            .join(', ')}
                      {namedColors.length > 0
                        ? ` · 샘플 ${formatNumber(sampleCount)}/${formatNumber(namedColors.length)}`
                        : ''}
                      {draft.owner ? ` · ${draft.owner}` : ''}
                    </div>
                  </div>
                </div>

                <div className="flex min-w-0 items-center gap-2 sm:max-w-[28rem] sm:justify-end">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    {order.url ? (
                      <a
                        href={order.url}
                        download={fileName}
                        className="block truncate text-sm underline-offset-2 hover:underline"
                      >
                        {fileName}
                      </a>
                    ) : (
                      <span className="block truncate text-sm">작업 지시서</span>
                    )}
                    <div className="text-[11px] text-muted-foreground">
                      {formatSavedAt(order.shippedAt || draft.updatedAt)}{' '}
                      {order.passed
                        ? '합격'
                        : failReason
                          ? '불합격'
                          : done
                            ? '발송'
                            : '저장'}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!order.url}
                    onClick={() => {
                      if (!order.url) return
                      const link = document.createElement('a')
                      link.href = order.url
                      link.download = fileName
                      link.rel = 'noreferrer'
                      link.click()
                    }}
                  >
                    <Download className="size-3.5" />
                    받기
                  </Button>
                  <Button
                    type="button"
                    variant={done ? 'secondary' : 'outline'}
                    size="sm"
                    aria-pressed={done}
                    disabled={!order.url || done || shippingThis}
                    className={cn(
                      done &&
                        'border-success/40 bg-success/10 text-foreground hover:bg-success/15',
                    )}
                    onClick={() =>
                      shipMutation.mutate({ draft, orderId: order.id })
                    }
                  >
                    {done ? <Check className="size-3.5" /> : null}
                    {shippingThis ? '저장 중...' : '발송 완료'}
                  </Button>
                </div>
                </div>
                {note ? (
                  <p className="rounded-md bg-muted/70 px-2.5 py-2 text-xs whitespace-pre-wrap">
                    {done ? '불합격 사유' : '중점'}: {note}
                  </p>
                ) : null}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
