import { cn, formatNumber } from '@/lib/utils'

export type ScopeCard<T extends string> = {
  value: T
  label: string
  /** 동그라미 안 짧은 글자(예: ALL, 기획). */
  badge: string
  /** 큰 숫자. null이면 아직 모름(—). */
  total: number | null
  /** 숫자 옆 보조 건수. count가 0보다 크면 레드로 강조한다. */
  detail?: { label: string; count: number | null }
}

/** 화면 위 범위 선택 카드(기획안 브랜드 카드와 같은 모양). 고른 카드를 다시 누르면 첫 카드(전체)로 돌아간다. */
export function ScopeCards<T extends string>({
  cards,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  cards: ScopeCard<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  className?: string
}) {
  const first = cards[0]?.value
  return (
    <div role="group" aria-label={ariaLabel} className={cn('flex flex-wrap items-center gap-2', className)}>
      {cards.map(card => {
        const active = card.value === value
        const hot = Boolean(card.detail?.count)
        return (
          <button
            key={card.value}
            type="button"
            aria-pressed={active}
            title={active && card.value !== first ? '다시 누르면 전체' : card.label}
            onClick={() => onChange(active && first !== undefined ? first : card.value)}
            className={cn(
              'inline-flex min-w-[150px] items-center gap-2 rounded-full border bg-card py-1 pl-1.5 pr-4 text-left transition-colors',
              active ? 'border-foreground shadow-sm' : 'border-border hover:border-foreground/30',
            )}
          >
            <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-bold text-background">
              {card.badge}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-semibold tracking-wide">{card.label}</span>
              <span className="mt-0.5 flex items-baseline gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
                <span className="text-sm font-semibold tabular-nums text-foreground">{card.total === null ? '—' : formatNumber(card.total)}</span>
                {card.detail ? (
                  <span className={cn('tabular-nums', hot && 'font-semibold text-primary')}>
                    {card.detail.label} {card.detail.count === null ? '—' : formatNumber(card.detail.count)}
                  </span>
                ) : null}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * 부서 범위 카드 목록. 전체 + 항목이 있는 부서 + 소속 없음 순서다.
 * total은 기본으로 항목 수이고, 사람 수처럼 다르게 셀 때는 count를 넘긴다.
 */
export function departmentScopeCards<T>({ items, departments, departmentOf, count, detail, unavailable = false }: {
  items: readonly T[]
  departments: readonly { id: string; name: string }[]
  departmentOf: (item: T) => string | null | undefined
  count?: (items: T[]) => number
  detail?: { label: string; count: (items: T[]) => number }
  unavailable?: boolean
}): ScopeCard<string>[] {
  const card = (value: string, label: string, badge: string, scoped: T[]): ScopeCard<string> => ({
    value, label, badge,
    total: unavailable ? null : count ? count(scoped) : scoped.length,
    ...(detail ? { detail: { label: detail.label, count: unavailable ? null : detail.count(scoped) } } : {}),
  })
  const all = [...items]
  const unassigned = all.filter(item => !departmentOf(item))
  return [
    card('all', '전체', 'ALL', all),
    ...departments.flatMap(dept => {
      const scoped = all.filter(item => departmentOf(item) === dept.id)
      return scoped.length ? [card(dept.id, dept.name, scopeBadge(dept.name), scoped)] : []
    }),
    ...(unassigned.length ? [card('unassigned', '소속 없음', '—', unassigned)] : []),
  ]
}

/** 부서 카드 값으로 항목을 거른다. */
export function inDepartmentScope(scope: string, departmentId: string | null | undefined) {
  return scope === 'all' || (scope === 'unassigned' ? !departmentId : departmentId === scope)
}

/** 부서 이름을 동그라미용 짧은 글자로 줄인다(기획팀 → 기획, 운영지원팀 → 운영, MD팀 → MD). */
export function scopeBadge(name: string) {
  const short = name.replace(/\s*(팀|team)$/i, '').trim() || name
  return /^[A-Za-z0-9]/.test(short) ? short.slice(0, 3) : short.slice(0, 2)
}
