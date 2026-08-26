import { useMemo, useState } from 'react'
import { StyleMultiPicker } from '@/components/style-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type {
  GiftSourceGroup,
  GiftSourceSessionRule,
} from '@/lib/invoice/gift-source-transform'
import type { InvoiceGiftSourceAssignmentMode, StyleRef } from '@/lib/types'
import { formatNumber } from '@/lib/utils'

export function InvoiceGiftSourceQuickSetup({
  brandId,
  group,
  applying,
  error,
  onApplySession,
  onApplyPersist,
  onTreatAsRegular,
}: {
  brandId: string
  group: GiftSourceGroup
  applying: boolean
  error: string | null
  onApplySession: (rule: GiftSourceSessionRule) => void
  onApplyPersist: (rule: GiftSourceSessionRule) => void
  onTreatAsRegular?: () => void
}) {
  const [selected, setSelected] = useState<StyleRef[]>(group.poolStyles)
  const [mode, setMode] = useState<InvoiceGiftSourceAssignmentMode>(
    group.assignmentMode ??
      (group.recommendsBalancedRandom ? 'balanced_random' : 'fixed'),
  )
  const [scope, setScope] = useState<'session' | 'persist'>('session')

  const effectiveMode: InvoiceGiftSourceAssignmentMode =
    selected.length <= 1 ? 'fixed' : mode

  const canApply = selected.length > 0 && !applying

  const rule = useMemo<GiftSourceSessionRule>(
    () => ({
      assignmentMode: effectiveMode,
      poolStyles: selected,
    }),
    [effectiveMode, selected],
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium">품목명 대체</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {group.mallName || '쇼핑몰 없음'} · {group.productName}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            대상 {formatNumber(group.rowCount)}행 · 수량{' '}
            {formatNumber(group.quantitySum)}
            {group.unassignedSlotCount > 0
              ? ` · 미배정 ${formatNumber(group.unassignedSlotCount)}`
              : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {group.status === 'map_found' ? (
            <Badge variant="warning">기존 설정 발견</Badge>
          ) : group.status === 'assigned' ? (
            <Badge variant="success">사은품 변환 완료</Badge>
          ) : (
            <Badge variant="danger">사은품 처리 필요</Badge>
          )}
          {group.recommendsBalancedRandom ? (
            <Badge variant="outline">균등 랜덤 추천</Badge>
          ) : null}
        </div>
      </div>

      {group.status === 'assigned' && group.assignedCounts.length > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {group.assignedCounts
            .map(
              (item) =>
                `${item.style.styleNo} ${formatNumber(item.count)}`,
            )
            .join(' · ')}
        </p>
      ) : null}

      {group.status === 'map_found' ? (
        <p className="text-[11px] text-muted-foreground">
          저장된 설정이 있지만 후보가 없거나 이번 파일에서 배정하지 못했습니다.
          후보를 고른 뒤 적용하세요.
        </p>
      ) : null}

      <StyleMultiPicker
        brandId={brandId}
        selected={selected}
        onChange={setSelected}
        placeholder="사은품 M번호 검색"
      />

      <div className="flex flex-wrap gap-3 text-[11px]">
        <label className="inline-flex items-center gap-1.5">
          <input
            type="radio"
            name={`gift-source-mode-${group.key}`}
            checked={effectiveMode === 'fixed'}
            disabled={selected.length > 1}
            onChange={() => setMode('fixed')}
          />
          고정 1종
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="radio"
            name={`gift-source-mode-${group.key}`}
            checked={effectiveMode === 'balanced_random'}
            disabled={selected.length <= 1}
            onChange={() => setMode('balanced_random')}
          />
          균등 랜덤
          </label>
      </div>

      <div className="flex flex-wrap gap-3 text-[11px]">
        <label className="inline-flex items-center gap-1.5">
          <input
            type="radio"
            name={`gift-source-scope-${group.key}`}
            checked={scope === 'session'}
            onChange={() => setScope('session')}
          />
          이번 파일에서만
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="radio"
            name={`gift-source-scope-${group.key}`}
            checked={scope === 'persist'}
            onChange={() => setScope('persist')}
          />
          다음 주문에도 자동 적용
        </label>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {scope === 'session'
          ? '이 파일에만 적용하고 원장에는 남기지 않습니다.'
          : '원장에 저장하면 다음 파일부터 같은 쇼핑몰·품목명에 바로 적용됩니다.'}
      </p>

      {error ? <p className="text-[11px] text-danger">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className="h-7 px-2 text-[11px]"
          disabled={!canApply}
          onClick={() => {
            if (scope === 'session') onApplySession(rule)
            else onApplyPersist(rule)
          }}
        >
          {applying ? '적용 중...' : '적용'}
        </Button>
        {onTreatAsRegular ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            disabled={applying}
            onClick={onTreatAsRegular}
          >
            일반 상품으로 처리
          </Button>
        ) : null}
      </div>
    </div>
  )
}
