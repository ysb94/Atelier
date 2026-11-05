import { cn, formatNumber } from '@/lib/utils'

export type FilterTab<T extends string> = {
  value: T
  label: string
  count?: number
  /** 담당자 탭의 기획안 수. 왼쪽은 진행, 오른쪽은 출시 전 종료. */
  workload?: { open: number; resting: number }
  /** 탭 이름 위에 두는 건수. */
  aboveCount?: number
  /** 탭 이름 옆 괄호 건수. */
  parenCount?: number
}

/** 목록 상단의 상태별 탭. 건수를 같이 보이고, 고른 탭은 테두리와 굵은 글씨로 구분한다. */
export function FilterTabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  variant = 'default',
  size = 'default',
  className,
}: {
  tabs: FilterTab<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  variant?: 'default' | 'underline'
  size?: 'default' | 'large'
  className?: string
}) {
  const underline = variant === 'underline'
  return (
    <div role="group" aria-label={ariaLabel} className={cn(underline ? 'flex min-w-0 items-end gap-2 overflow-x-auto border-b border-border' : 'flex flex-wrap gap-1.5', className)}>
      {tabs.map((tab) => {
        const active = tab.value === value
        return (
          <button
            key={tab.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              'inline-flex items-center gap-1.5 transition-colors',
              underline
                ? cn('shrink-0 whitespace-nowrap border-b-2', size === 'large' ? 'min-w-32 justify-center px-6 py-4 text-base' : 'px-4 py-3 text-sm', tab.aboveCount !== undefined && 'flex-col gap-0 py-2', active ? 'border-primary font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')
                : cn('rounded-lg border px-3 py-1.5 text-sm', active ? 'border-foreground bg-card font-semibold text-foreground shadow-sm' : 'border-border text-muted-foreground hover:bg-card hover:text-foreground'),
              tab.count === 0 && !active && 'opacity-50',
            )}
          >
            {tab.aboveCount !== undefined ? <span className="text-sm font-semibold tabular-nums text-primary" title="아직 받지 않은 작업지시서">{formatNumber(tab.aboveCount)}</span> : null}
            {tab.label}
            {tab.parenCount !== undefined ? <span className="tabular-nums" title="아직 받지 않은 작업지시서">({formatNumber(tab.parenCount)})</span> : null}
            {tab.workload ? (
              <span className="text-xs tabular-nums text-muted-foreground" title="진행 중인 기획안 / 샘플이 끝났지만 출시 전인 기획안">
                (<span className="text-primary"> {formatNumber(tab.workload.open)} </span>/ {formatNumber(tab.workload.resting)} )
              </span>
            ) : null}
            {tab.count !== undefined ? (
              <span
                className={cn(
                  'text-xs tabular-nums',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {formatNumber(tab.count)}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
