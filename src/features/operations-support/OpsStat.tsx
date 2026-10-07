import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function OpsStat({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-4 sm:px-5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
        {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
      </div>
    </div>
  )
}

export function DraftNotice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-foreground">
      {children}
    </p>
  )
}

export function memberLabel(name: string | null) {
  return name?.trim() || '이름 없음'
}

export function OpsPanelFrame({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-4', className)} role="tabpanel">
      {children}
    </div>
  )
}
