import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export type StatTone = 'default' | 'success' | 'danger' | 'muted'

/** 화면 위쪽 요약 숫자 한 칸. accent를 켜면 윗선을 레드로 강조한다. */
export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
  accent = false,
  icon: Icon,
  className,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: StatTone
  accent?: boolean
  icon?: LucideIcon
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-4 shadow-sm sm:px-5',
        accent && 'border-t-[3px] border-t-primary',
        className,
      )}
    >
      {Icon ? (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p
            className={cn(
              'text-2xl font-bold tracking-tight tabular-nums',
              tone === 'success' && 'text-success',
              tone === 'danger' && 'text-danger',
              tone === 'muted' && 'text-muted-foreground',
            )}
          >
            {value}
          </p>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
      </div>
    </div>
  )
}

export function StatGrid({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4', className)}>
      {children}
    </div>
  )
}
