import { cn } from '@/lib/utils'

export type ProgressSegment = { label: string; ratio: number }

/** 단계별 진행률. 칸마다 0~1 비율을 채우고 오른쪽에 평균을 숫자로 보인다. */
export function SegmentProgress({
  segments,
  className,
}: {
  segments: ProgressSegment[]
  className?: string
}) {
  const average = segments.length
    ? segments.reduce((sum, item) => sum + item.ratio, 0) / segments.length
    : 0
  const percent = Math.round(average * 100)
  const summary = segments
    .map((item) => `${item.label} ${Math.round(item.ratio * 100)}%`)
    .join(' · ')

  return (
    <div className={cn('flex items-center gap-2', className)} title={summary}>
      <div className="flex items-center gap-0.5" aria-hidden>
        {segments.map((item) => {
          const pct = Math.round(item.ratio * 100)
          return (
            <span
              key={item.label}
              className="relative h-1.5 w-5 overflow-hidden rounded-full bg-muted"
            >
              <span
                className={cn(
                  'absolute inset-y-0 left-0 rounded-full',
                  pct >= 100 ? 'bg-success' : 'bg-primary',
                )}
                style={{ width: `${pct}%` }}
              />
            </span>
          )
        })}
      </div>
      <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
        <span className="sr-only">진행률 </span>
        {percent}%
      </span>
    </div>
  )
}
