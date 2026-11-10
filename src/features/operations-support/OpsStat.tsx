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

/** 표의 직원 칸: 이니셜 동그라미 + 이름 + 보조 글자(부서·직책 등). */
export function MemberCell({ name, sub }: { name: string; sub?: ReactNode }) {
  return (
    <span className="flex items-center gap-2.5">
      {/* 이니셜은 CSS로만 그려 이름 칸의 글자(복사·검색·검증)에 섞이지 않게 한다. */}
      <span aria-hidden data-initial={name.trim().charAt(0) || '?'} className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold text-foreground before:content-[attr(data-initial)]" />
      <span className="min-w-0">
        <span className="block font-medium">{name}</span>
        {sub ? <span className="block text-xs text-muted-foreground">{sub}</span> : null}
      </span>
    </span>
  )
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
