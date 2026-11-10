import { Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** 화면 위 긴 설명을 접어 두는 ⓘ 안내. 누르면 펼쳐지고, 기본은 한 줄만 차지한다. */
export function InfoNote({
  label = '기준 보기',
  children,
  className,
}: {
  label?: string
  children: ReactNode
  className?: string
}) {
  return (
    <details className={cn('text-sm', className)}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
        <Info className="size-3.5" aria-hidden />
        {label}
      </summary>
      <div className="mt-1.5 max-w-4xl space-y-1 rounded-lg border border-border bg-card px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        {children}
      </div>
    </details>
  )
}
