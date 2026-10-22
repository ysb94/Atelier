import { cn } from '@/lib/utils'
import type { HTMLAttributes } from 'react'

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'outline' | 'muted'
}

export function Badge({
  className,
  variant = 'default',
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        variant === 'default' && 'border-primary/30 bg-primary/10 text-primary',
        variant === 'success' && 'border-success/30 bg-success/10 text-success',
        variant === 'warning' && 'border-warning/35 bg-warning/10 text-warning',
        variant === 'danger' && 'border-danger/30 bg-danger/10 text-danger',
        variant === 'outline' && 'border-border text-foreground',
        variant === 'muted' &&
          'border-transparent bg-muted text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}
