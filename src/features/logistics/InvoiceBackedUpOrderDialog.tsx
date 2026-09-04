import { WorkspaceTabOverlay } from '@/components/layout/workspace-tabs'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/lib/utils'

export function InvoiceBackedUpOrderDialog({
  orderCount,
  rowCount,
  workRowCount,
  onCancel,
  onConfirm,
}: {
  orderCount: number
  rowCount: number
  workRowCount: number
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <WorkspaceTabOverlay>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button
          type="button"
          className="absolute inset-0 bg-black/40"
          aria-label="닫기"
          onClick={onCancel}
        />
        <div
          role="dialog"
          aria-modal="true"
          className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg"
        >
          <h2 className="text-base font-semibold">이미 백업된 주문이 있습니다</h2>
          <p className="mt-2 text-sm leading-6">
            고객주문번호·쇼핑몰명·주문일시가 같은 주문{' '}
            <span className="font-medium">
              {formatNumber(orderCount)}건 · {formatNumber(rowCount)}행
            </span>
            이 이전에 출고반영 백업됐습니다. 제외하고 진행할까요?
          </p>
          <p className="mt-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            {workRowCount === 0
              ? '제외하면 이번 파일에서 진행할 주문이 없습니다.'
              : `제외하면 작업 대상은 ${formatNumber(workRowCount)}행입니다.`}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onCancel}>
              취소
            </Button>
            <Button type="button" size="sm" onClick={onConfirm}>
              제외하고 진행
            </Button>
          </div>
        </div>
      </div>
    </WorkspaceTabOverlay>
  )
}
