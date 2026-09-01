import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, History } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { getInvoiceWorkRuns } from '@/lib/api'
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

/** 송장작업 완료 이력·사이트별 출고 수량. 개인정보는 없다. */
export function InvoiceWorkHistoryPanel({ brandId }: { brandId: string }) {
  const [openId, setOpenId] = useState<string | null>(null)
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
                        </tr>
                        {open ? (
                          <tr className="border-t border-border bg-muted/30">
                            <td colSpan={8} className="px-3 py-3">
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
                CJ 13열을 내려받으면 파일명·작업자·사이트별 주문·출고 수량이
                남습니다. 수령인 정보는 저장하지 않습니다.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
