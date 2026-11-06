import { cn, formatNumber } from '@/lib/utils'
import type { ComponentPropsWithoutRef } from 'react'

type TabInteractionProps = Pick<ComponentPropsWithoutRef<'button'>,
  'draggable' | 'onDragStart' | 'onDragOver' | 'onDragLeave' | 'onDrop' | 'onDragEnd' | 'onKeyDown' | 'title' | 'className'>

export type FilterTab<T extends string> = {
  value: T
  label: string
  subtitle?: string
  count?: number
  /** 탭의 진행 / 대기 업무 수. */
  workload?: { open: number; resting: number; title?: string }
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
  tabInteraction,
}: {
  tabs: FilterTab<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  variant?: 'default' | 'underline'
  size?: 'default' | 'large'
  className?: string
  tabInteraction?: (value: T) => TabInteractionProps | undefined
}) {
  const underline = variant === 'underline'
  return (
    <div role="group" aria-label={ariaLabel} className={cn(underline ? 'flex min-w-0 items-end gap-2 overflow-x-auto border-b border-border' : 'flex flex-wrap gap-1.5', className)}>
      {tabs.map((tab) => {
        const active = tab.value === value
        const interaction = tabInteraction?.(tab.value)
        return (
          <button
            {...interaction}
            key={tab.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              'inline-flex items-center gap-1.5 transition-colors',
              underline
                ? cn('shrink-0 whitespace-nowrap border-b-2', size === 'large' ? 'min-w-32 justify-center px-6 py-4 text-base' : 'px-4 py-3 text-sm', tab.aboveCount !== undefined && 'items-end py-2', active ? 'border-primary font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')
                : cn('rounded-lg border px-3 py-1.5 text-sm', active ? 'border-foreground bg-card font-semibold text-foreground shadow-sm' : 'border-border text-muted-foreground hover:bg-card hover:text-foreground'),
              tab.count === 0 && !active && 'opacity-50',
              interaction?.className,
            )}
          >
            {tab.aboveCount !== undefined ? (
              <span className="flex flex-col items-center">
                <span className="text-sm font-semibold tabular-nums text-primary" title="미확인 건수">{formatNumber(tab.aboveCount)}</span>
                <span>{tab.label}</span>
              </span>
            ) : tab.subtitle ? (
              <span className="flex flex-col items-center gap-0.5">
                <span>{tab.label}</span>
                <span className="text-xs font-normal tabular-nums text-muted-foreground">{tab.subtitle}</span>
              </span>
            ) : tab.label}
            {tab.parenCount !== undefined ? <span className="tabular-nums" title="아직 받지 않은 작업지시서">({formatNumber(tab.parenCount)})</span> : null}
            {tab.workload ? (
              <span className="text-xs tabular-nums text-muted-foreground" title={tab.workload.title ?? '진행 중인 기획안 / 샘플이 끝났지만 출시 전인 기획안'}>
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
