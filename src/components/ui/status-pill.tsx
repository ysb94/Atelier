import { cn } from '@/lib/utils'
import type { HTMLAttributes } from 'react'

export type StatusTone =
  | 'default'
  | 'success'
  | 'warning'
  | 'danger'
  | 'muted'
  | 'outline'

const TONE: Record<StatusTone, string> = {
  default: 'border-primary/30 bg-primary/10 text-primary',
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/35 bg-warning/10 text-warning',
  danger: 'border-danger/30 bg-danger/10 text-danger',
  muted: 'border-border bg-muted text-muted-foreground',
  outline: 'border-border bg-card text-foreground',
}

type StatusPillProps = HTMLAttributes<HTMLSpanElement> & { tone?: StatusTone }

export function StatusPill({
  tone = 'outline',
  className,
  children,
  ...props
}: StatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium',
        TONE[tone],
        className,
      )}
      {...props}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  )
}
