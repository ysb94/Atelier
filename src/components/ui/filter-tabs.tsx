import { cn, formatNumber } from '@/lib/utils'

export type FilterTab<T extends string> = {
  value: T
  label: string
  count?: number
}

/** 목록 상단의 상태별 탭. 건수를 같이 보이고, 고른 탭은 테두리와 굵은 글씨로 구분한다. */
export function FilterTabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
}: {
  tabs: FilterTab<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {tabs.map((tab) => {
        const active = tab.value === value
        return (
          <button
            key={tab.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors',
              active
                ? 'border-foreground bg-card font-semibold text-foreground shadow-sm'
                : 'border-border text-muted-foreground hover:bg-card hover:text-foreground',
              tab.count === 0 && !active && 'opacity-50',
            )}
          >
            {tab.label}
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
