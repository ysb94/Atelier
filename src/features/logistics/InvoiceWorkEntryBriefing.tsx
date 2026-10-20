import { Fragment, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useRenderWatch } from '@/lib/diagnostics'
import {
  blockedShipmentProducts,
  giftEventsValidToday,
  INVOICE_BLOCKED_SHIPMENT_REASON_LABEL,
} from '@/lib/invoice/invoice-work-briefing'
import { nowMoment } from '@/lib/invoice/prefix-transform'
import {
  getInvoiceDiscontinuedStyles,
  getInvoiceGiftRequests,
  getInvoicePreorderHolds,
} from '@/lib/api'
import type {
  Brand,
  InvoiceDiscontinuedStyle,
  InvoiceGiftRequest,
  InvoicePreorderHold,
} from '@/lib/types'
import { emptyList } from '@/lib/utils'

function useBriefingHeight(node: HTMLElement | null) {
  const [height, setHeight] = useState<number>()
  useEffect(() => {
    const host = document.querySelector<HTMLElement>('[data-brand-page-scroll]')
    if (!host || !node) return
    const update = () => {
      const wrapper = host.firstElementChild
      const padBottom = wrapper instanceof HTMLElement
        ? Number.parseFloat(getComputedStyle(wrapper).paddingBottom) || 0
        : 0
      const next = Math.floor(host.getBoundingClientRect().bottom - node.getBoundingClientRect().top - padBottom)
      setHeight(Math.max(360, next))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [node])
  return height
}

export function InvoiceWorkEntryBriefing({
  brand,
  onStart,
}: {
  brand: Pick<Brand, 'id' | 'name'>
  onStart: () => void
}) {
  useRenderWatch('InvoiceWorkEntryBriefing')
  const now = nowMoment()
  const eventsQuery = useQuery({
    queryKey: ['invoice-prefix-requests', brand.id],
    queryFn: () => getInvoiceGiftRequests(brand.id),
    staleTime: 5 * 60_000,
  })
  const holdsQuery = useQuery({
    queryKey: ['invoice-preorder-holds', brand.id, 'active'],
    queryFn: () => getInvoicePreorderHolds(brand.id, 'active'),
    staleTime: 5 * 60_000,
  })
  const discontinuedQuery = useQuery({
    queryKey: ['invoice-discontinued-styles', brand.id],
    queryFn: () => getInvoiceDiscontinuedStyles(brand.id),
    staleTime: 5 * 60_000,
  })
  useEffect(() => {
    if (eventsQuery.error) console.warn('[invoice-work] 오늘 이벤트 조회 실패', eventsQuery.error)
  }, [eventsQuery.error])
  useEffect(() => {
    if (holdsQuery.error) console.warn('[invoice-work] 예약발송 조회 실패', holdsQuery.error)
  }, [holdsQuery.error])
  useEffect(() => {
    if (discontinuedQuery.error) console.warn('[invoice-work] 단종 목록 조회 실패', discontinuedQuery.error)
  }, [discontinuedQuery.error])

  const loading = eventsQuery.isPending || holdsQuery.isPending || discontinuedQuery.isPending
  const failed = eventsQuery.isError || holdsQuery.isError || discontinuedQuery.isError
  const events = giftEventsValidToday(
    eventsQuery.data ?? emptyList<InvoiceGiftRequest>(),
    now,
  )
  const blocked = blockedShipmentProducts(
    holdsQuery.data ?? emptyList<InvoicePreorderHold>(),
    discontinuedQuery.data ?? emptyList<InvoiceDiscontinuedStyle>(),
  )

  function retry() {
    void eventsQuery.refetch()
    void holdsQuery.refetch()
    void discontinuedQuery.refetch()
  }

  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const height = useBriefingHeight(root)
  const [, setSearchParams] = useSearchParams()

  function goManage(manage: 'gifts' | 'preorder' | 'discontinued', edit?: string) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('view', 'rules')
      next.set('manage', manage)
      if (edit) next.set('edit', edit)
      else next.delete('edit')
      return next
    })
    onStart()
  }

  return (
    <div
      ref={setRoot}
      className="flex min-h-0 flex-col gap-4"
      style={{ height: height ?? 'calc(100dvh - 8rem)' }}
    >
      <PageHeader
        title="온라인 송장작업 시작 전 확인"
        description={`${brand.name} 오늘 적용되는 이벤트와 지금 출고할 수 없는 상품을 확인한 뒤 작업으로 들어갑니다.`}
      />
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>오늘 유효한 이벤트</CardTitle>
            <Button type="button" size="sm" variant="outline" onClick={() => goManage('gifts', 'new')}>
              행사 추가
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {eventsQuery.isPending ? (
            <p className="text-sm text-muted-foreground">이벤트를 불러오는 중...</p>
          ) : eventsQuery.isError ? (
            <p className="text-sm text-danger" role="alert">이벤트를 불러오지 못했습니다.</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">오늘 적용되는 이벤트가 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-border text-xs text-muted-foreground">
                  <tr>
                    {['행사', '쇼핑몰', '기간', '상태'].map((label) => (
                      <th key={label} className="px-3 py-2 font-medium">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <Fragment key={event.id}>
                      <tr>
                        <td className="px-3 pt-3 font-medium">{event.title}</td>
                        <td className="px-3 pt-3">{event.mallName}</td>
                        <td className="px-3 pt-3 tabular-nums">{event.startsAt} ~ {event.endsAt}</td>
                        <td className="px-3 pt-3">
                          <Badge variant={event.phase === 'running' ? 'default' : 'warning'}>
                            {event.phase === 'running' ? '진행 중' : '오늘 시작 예정'}
                          </Badge>
                        </td>
                      </tr>
                      <tr className="border-b border-border last:border-0">
                        <td colSpan={4} className="px-3 pb-3 pt-1">
                          <div className="flex items-start justify-between gap-3">
                            {event.gifts.length === 0 ? (
                              <p className="text-muted-foreground">품목명 · 사은품 없음</p>
                            ) : (
                              <div className="space-y-1">
                                {event.gifts.map((gift) => (
                                  <p key={gift.id}>
                                    <span>{gift.productName}</span>
                                    <span className="text-muted-foreground">
                                      {' → '}
                                      {gift.giftNames.join(', ') || '사은품 없음'}
                                    </span>
                                  </p>
                                ))}
                              </div>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="shrink-0"
                              onClick={() => goManage('gifts', event.id)}
                            >
                              관리
                            </Button>
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader className="shrink-0">
          <CardTitle>지금 출고할 수 없는 상품</CardTitle>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              예약발송과 단종 상품입니다. 재고부족 상품 목록은 아직 기준정보에 연결되어 있지 않습니다.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => goManage('preorder')}>
                예약발송 추가
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => goManage('discontinued')}>
                단종 추가
              </Button>
            </div>
          </div>
          {holdsQuery.isPending || discontinuedQuery.isPending ? (
            <p className="text-sm text-muted-foreground">출고 불가 상품을 불러오는 중...</p>
          ) : holdsQuery.isError || discontinuedQuery.isError ? (
            <p className="text-sm text-danger" role="alert">출고 불가 상품을 불러오지 못했습니다.</p>
          ) : blocked.length === 0 ? (
            <p className="text-sm text-muted-foreground">등록된 예약발송·단종 상품이 없습니다.</p>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="sticky top-0 border-b border-border bg-card text-xs text-muted-foreground">
                  <tr>
                    {['M번호', '상품명', '사유', '내용', '관리'].map((label) => (
                      <th key={label} className="px-3 py-2 font-medium">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {blocked.map((item) => (
                    <tr key={`${item.reason}:${item.styleId}`} className="border-b border-border last:border-0">
                      <td className="px-3 py-3 font-medium tabular-nums">{item.styleNo}</td>
                      <td className="px-3 py-3">{item.name}</td>
                      <td className="px-3 py-3">
                        <Badge variant={item.reason === 'discontinued' ? 'danger' : 'warning'}>
                          {INVOICE_BLOCKED_SHIPMENT_REASON_LABEL[item.reason]}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{item.detail}</td>
                      <td className="px-3 py-3">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => goManage(item.reason === 'reservation' ? 'preorder' : 'discontinued', item.id)}
                        >
                          관리
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border py-3">
        {failed ? (
          <Button type="button" variant="outline" onClick={retry}>다시 불러오기</Button>
        ) : null}
        <Button type="button" disabled={loading || failed} onClick={onStart}>
          {loading ? '확인 목록을 불러오는 중...' : '확인하고 온라인 송장작업 시작'}
        </Button>
      </div>
    </div>
  )
}
