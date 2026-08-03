import { cn } from '@/lib/utils'
import type { ButtonHTMLAttributes } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'secondary' | 'ghost' | 'outline'
  size?: 'sm' | 'md' | 'lg'
}

export function Button({
  className,
  variant = 'default',
  size = 'md',
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
        variant === 'default' &&
          'bg-primary text-primary-foreground hover:bg-primary/90',
        variant === 'secondary' &&
          'bg-muted text-foreground hover:bg-accent',
        variant === 'ghost' && 'hover:bg-muted text-foreground',
        variant === 'outline' &&
          'border border-border bg-card hover:bg-muted text-foreground',
        size === 'sm' && 'h-8 px-3 text-xs',
        size === 'md' && 'h-9 px-4 text-sm',
        size === 'lg' && 'h-11 px-5 text-sm',
        className,
      )}
      {...props}
    />
  )
}
