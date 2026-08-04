import { cn } from '@/lib/utils'
import type { Brand } from '@/lib/types'

type BrandAvatarProps = {
  brand: Pick<Brand, 'name' | 'color' | 'logoUrl'>
  className?: string
  textClassName?: string
}

export function BrandAvatar({
  brand,
  className,
  textClassName,
}: BrandAvatarProps) {
  const initials = brand.name.trim().slice(0, 2).toUpperCase() || 'BR'

  if (brand.logoUrl) {
    return (
      <div
        className={cn(
          'shrink-0 overflow-hidden rounded-xl bg-muted',
          className,
        )}
      >
        <img
          src={brand.logoUrl}
          alt={`${brand.name} 로고`}
          className="size-full object-cover"
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white',
        className,
      )}
      style={{ backgroundColor: brand.color }}
    >
      <span className={textClassName}>{initials}</span>
    </div>
  )
}
