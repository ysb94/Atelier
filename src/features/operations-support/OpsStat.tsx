import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { StatTile } from '@/components/ui/stat-tile'

export function OpsStat({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}) {
  return <StatTile label={label} value={value} hint={detail} />
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
