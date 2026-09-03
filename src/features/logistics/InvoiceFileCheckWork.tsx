import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { InvoiceMallResolution } from '@/lib/invoice/mall-resolution'
import { formatNumber } from '@/lib/utils'

export function InvoiceFileCheckTransformWork({
  missingProductCodeCount,
  nextStepLabel,
}: {
  missingProductCodeCount: number
  nextStepLabel: string
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border p-4">
      <div>
        <p className="text-sm font-medium">변환</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          품목명·내품명 변환은 {nextStepLabel}에서 합니다. 자체품번코드가 비어
          있어도 건너뛰지 않고 같은 기준으로 맞춥니다.
          {missingProductCodeCount > 0
            ? ` 지금 파일에서 코드가 비어 있는 행은 ${formatNumber(missingProductCodeCount)}행입니다.`
            : null}
        </p>
      </div>
    </div>
  )
}

export function InvoiceFileCheckMallWork({
  resolution,
  partnersReady,
  partnersError,
  blockLabel,
  onOpen,
}: {
  resolution: InvoiceMallResolution
  partnersReady: boolean
  partnersError: boolean
  blockLabel: string
  onOpen: () => void
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">쇼핑몰명 연결</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            고유 {formatNumber(resolution.uniqueCount)}곳 · 연결 완료{' '}
            {formatNumber(resolution.matchedCount)}곳 · 연결 필요{' '}
            {formatNumber(resolution.unresolvedCount)}곳
          </p>
        </div>
        {resolution.unresolvedCount > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!partnersReady}
            onClick={onOpen}
          >
            쇼핑몰명 연결
          </Button>
        ) : (
          <Badge variant="success">연결 완료</Badge>
        )}
      </div>
      {!partnersReady && !partnersError ? (
        <p className="text-xs text-muted-foreground">
          출고업체 목록을 확인하는 중...
        </p>
      ) : partnersError ? (
        <p className="text-xs text-danger">
          출고업체를 불러오지 못해 쇼핑몰명을 연결할 수 없습니다.
        </p>
      ) : resolution.unresolvedCount > 0 ? (
        <p className="text-xs text-warning">
          미등록·빈 값·비활성 쇼핑몰을 정리하기 전에는 {blockLabel}
        </p>
      ) : null}
    </div>
  )
}
