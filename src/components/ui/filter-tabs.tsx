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
    <div role="group" aria-label={ariaLabel} className={cn(underline ? 'flex min-w-0 gap-2 overflow-x-auto border-b border-border' : 'flex flex-wrap gap-1.5', className)}>
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
                ? cn('shrink-0 whitespace-nowrap border-b-2', size === 'large' ? 'min-w-32 justify-center px-6 py-4 text-base' : 'px-4 py-3 text-sm', active ? 'border-primary font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')
                : cn('rounded-lg border px-3 py-1.5 text-sm', active ? 'border-foreground bg-card font-semibold text-foreground shadow-sm' : 'border-border text-muted-foreground hover:bg-card hover:text-foreground'),
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
