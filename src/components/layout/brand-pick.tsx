import { BrandAvatar } from '@/components/brand/BrandAvatar'
import { cn } from '@/lib/utils'
import type { Brand } from '@/lib/types'

export function BrandSelectedChip({
  brand,
  selected,
  disabled,
  onSelect,
}: {
  brand: Brand
  selected: boolean
  disabled?: boolean
  onSelect: (slug: string) => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={() => onSelect(brand.slug)}
      className={cn(
        'inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
        selected
          ? 'border-primary bg-primary/5 font-semibold text-foreground'
          : 'border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
        disabled &&
          !selected &&
          'cursor-not-allowed opacity-50 hover:bg-background/60 hover:text-muted-foreground',
      )}
    >
      <BrandAvatar brand={brand} className="size-5" />
      <span className="truncate">{brand.name}</span>
    </button>
  )
}
