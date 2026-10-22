import { cn } from '@/lib/utils'
import type { HTMLAttributes } from 'react'

/** 목록 위의 검색·선택 상자 묶음. 흰 카드 한 장에 모아 표와 구분한다. */
export function FilterBar({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'mb-4 flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-center',
        className,
      )}
      {...props}
    />
  )
}
