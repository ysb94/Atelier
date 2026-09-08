import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BrandAvatar } from '@/components/brand/BrandAvatar'
import { BrandScope } from './brand-context'
import { useCompanyBrandScope } from './company-brand-scope'
import { cn } from '@/lib/utils'
import type { Brand } from '@/lib/types'

export function BrandFromSlug({
  slug,
  children,
}: {
  slug?: string
  children: ReactNode
}) {
  const { brandBySlug, loading } = useCompanyBrandScope()
  const brand = slug ? brandBySlug.get(slug) : undefined
  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">브랜드를 불러오는 중...</p>
    )
  }
  if (!brand) {
    return (
      <p className="text-sm text-muted-foreground">
        브랜드를 찾을 수 없습니다.
      </p>
    )
  }
  return <BrandScope brand={brand}>{children}</BrandScope>
}

function BrandChip({
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
          ? 'border-foreground bg-background font-medium text-foreground'
          : 'border-border bg-background/60 text-muted-foreground hover:bg-muted/70 hover:text-foreground',
        disabled && !selected && 'cursor-not-allowed opacity-50 hover:bg-background/60 hover:text-muted-foreground',
      )}
    >
      <BrandAvatar brand={brand} className="size-5" />
      <span className="truncate">{brand.name}</span>
    </button>
  )
}

export function BrandTargetGate({
  children,
  title = '작업할 브랜드',
  description = '새로 만들거나 올리는 작업은 브랜드를 하나 고른 뒤에 시작합니다. 이미 있는 행을 고치는 일은 그 행의 브랜드를 따릅니다.',
  lockAfterSelect = false,
}: {
  children: ReactNode
  title?: string
  description?: string
  lockAfterSelect?: boolean
}) {
  const { brands, brandBySlug, loading, error } = useCompanyBrandScope()
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('brand')?.trim() ?? ''
  const brand = requested ? brandBySlug.get(requested) : undefined
  const locked = lockAfterSelect && Boolean(brand)

  function selectBrand(slug: string) {
    if (locked && slug !== requested) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (!slug) next.delete('brand')
        else next.set('brand', slug)
        return next
      },
      { replace: true },
    )
  }

  const chips = (
    <div className="mb-4 rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {loading ? (
          <p className="text-xs text-muted-foreground">브랜드를 불러오는 중...</p>
        ) : error ? (
          <p className="text-xs text-danger">브랜드 목록을 불러오지 못했습니다.</p>
        ) : brands.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            등록된 브랜드가 없습니다. 브랜드 관리에서 먼저 만들어 주세요.
          </p>
        ) : (
          brands.map((item) => (
            <BrandChip
              key={item.id}
              brand={item}
              selected={item.slug === requested}
              disabled={locked && item.slug !== requested}
              onSelect={selectBrand}
            />
          ))
        )}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {brand
          ? locked
            ? '이 작업은 선택한 브랜드에만 저장됩니다. 작업 중 브랜드는 바꾸지 않습니다.'
            : '저장은 이 브랜드에만 반영됩니다.'
          : description}
      </p>
      {requested && !brand && !loading ? (
        <p className="mt-1 text-xs text-danger">없는 브랜드입니다. 다시 고르세요.</p>
      ) : null}
    </div>
  )

  if (!brand) {
    return (
      <div>
        <h1 className="mb-3 text-xl font-semibold tracking-tight">{title}</h1>
        {chips}
      </div>
    )
  }

  return (
    <div>
      {chips}
      <BrandScope brand={brand}>{children}</BrandScope>
    </div>
  )
}
