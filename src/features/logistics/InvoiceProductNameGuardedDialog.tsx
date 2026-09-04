import { WorkspaceTabOverlay } from '@/components/layout/workspace-tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type {
  ExclusionGuardedReviewContext,
  InvoiceProductNameMatchStatus,
} from '@/lib/invoice/product-name-transform'
import type { ProductNameAiReviewRow } from '@/lib/invoice/product-name-ai-review'
import { formatNumber } from '@/lib/utils'

const STATUS_LABEL: Record<InvoiceProductNameMatchStatus, string> = {
  mapped: '자동 완료',
  candidate: '후보 1개',
  missing_style: 'M번호 발급 필요',
  conflict: '충돌',
  unresolved: '검토 필요',
  excluded: '상품 연결 예외',
  exclusion_guarded: '예외 보류',
  gift_pending: '사은품 처리 필요',
  gift_mapped: '사은품 변환 완료',
}

export function InvoiceProductNameGuardedDialog({
  row,
  context,
  liveKeys,
  pending,
  onClose,
  onJump,
  onDeactivate,
}: {
  row: ProductNameAiReviewRow
  context: ExclusionGuardedReviewContext
  liveKeys: ReadonlySet<string>
  pending?: boolean
  onClose: () => void
  onJump: (key: string) => void
  onDeactivate?: () => void
}) {
  return (
    <WorkspaceTabOverlay>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button
          type="button"
          className="absolute inset-0 bg-black/40"
          aria-label="닫기"
          onClick={onClose}
        />
        <div
          role="dialog"
          aria-modal="true"
          className="relative z-10 flex max-h-[min(80vh,40rem)] w-full max-w-xl flex-col rounded-xl border border-border bg-card p-5 shadow-lg"
        >
          <h2 className="text-base font-semibold">예외 보류</h2>
          <p className="mt-2 text-sm leading-6">
            이 행은 스스로 고칠 게 없습니다. 같은 주문의 본품을 확정하면
            풀립니다.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {row.mallName || '모든 쇼핑몰'} · {row.productName}
            {row.itemName ? ` · ${row.itemName}` : ''} · 주문{' '}
            {formatNumber(context.orderCount)}건
          </p>
          {context.ordersWithoutSibling > 0 ? (
            <p className="mt-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
              같은 주문에 다른 행이 없는 주문이{' '}
              {formatNumber(context.ordersWithoutSibling)}건 있습니다. 제외
              기준이 실제 상품까지 잡힌 신호일 수 있습니다.
            </p>
          ) : null}

          <div className="mt-3 max-h-52 space-y-2 overflow-auto">
            {context.siblings.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                같은 주문의 본품 후보가 없습니다.
              </p>
            ) : (
              context.siblings.map((sibling) => {
                const live = liveKeys.has(sibling.key)
                return (
                  <div
                    key={sibling.key}
                    className="rounded-md border border-border px-3 py-2"
                  >
                    <p className="text-xs">
                      {sibling.productName}
                      {sibling.itemName ? ` · ${sibling.itemName}` : ''}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {sibling.mallName || '모든 쇼핑몰'} ·{' '}
                      {formatNumber(sibling.rowCount)}행
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {STATUS_LABEL[sibling.status]}
                      </Badge>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px]"
                        disabled={!live}
                        onClick={() => onJump(sibling.key)}
                      >
                        {live ? '이 행으로 가기' : '이미 확정됨'}
                      </Button>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {onDeactivate && context.exclusionId ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={onDeactivate}
              >
                제외 기준 사용 안 함
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="outline" onClick={onClose}>
              닫기
            </Button>
          </div>
        </div>
      </div>
    </WorkspaceTabOverlay>
  )
}
