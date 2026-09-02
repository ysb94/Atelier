import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/lib/utils'

export function InvoiceTablePager({
  page,
  pageCount,
  total,
  startIndex,
  pageItemCount,
  onPage,
}: {
  page: number
  pageCount: number
  total: number
  startIndex: number
  pageItemCount: number
  onPage: (page: number) => void
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-muted-foreground">
        {total > 0
          ? `${formatNumber(total)}건 중 ${formatNumber(startIndex + 1)}–${formatNumber(
              startIndex + pageItemCount,
            )}건`
          : '표시할 항목 없음'}
      </p>
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(Math.max(1, page - 1))}
        >
          <ChevronLeft className="size-4" />
          이전
        </Button>
        <span className="min-w-20 text-center text-xs tabular-nums text-muted-foreground">
          {page} / {pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page >= pageCount}
          onClick={() => onPage(Math.min(pageCount, page + 1))}
        >
          다음
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}
