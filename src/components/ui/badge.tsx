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
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        variant === 'default' && 'bg-primary text-primary-foreground',
        variant === 'success' && 'bg-success/15 text-success',
        variant === 'warning' && 'bg-warning/15 text-warning',
        variant === 'danger' && 'bg-danger/15 text-danger',
        variant === 'outline' && 'border border-border text-foreground',
        variant === 'muted' && 'bg-muted text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}
