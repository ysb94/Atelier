import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BrandAvatar } from '@/components/brand/BrandAvatar'
import { BrandScope } from './brand-context'
import { BrandSelectedChip } from './brand-pick'
import { useCompanyBrandScope } from './company-brand-scope'
import { useWorkspaceTabActivity } from './workspace-tabs'
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

function BrandPickCard({
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
        'flex min-h-36 flex-col items-center justify-center gap-3 rounded-xl border px-4 py-6 text-center transition-colors',
        selected
          ? 'border-foreground bg-card text-foreground'
          : 'border-border bg-card text-foreground hover:bg-muted/50',
        disabled &&
          !selected &&
          'cursor-not-allowed opacity-50 hover:bg-card',
      )}
    >
      <BrandAvatar brand={brand} className="size-14" textClassName="text-lg" />
      <span className="text-base font-semibold tracking-tight">{brand.name}</span>
      {brand.nameKo ? (
        <span className="text-xs text-muted-foreground">{brand.nameKo}</span>
      ) : null}
    </button>
  )
}

export function BrandTargetGate({
  children,
  title = '작업할 브랜드를 골라 주세요',
  lockAfterSelect = false,
  autoSelectFirst = false,
}: {
  children: ReactNode
  title?: string
  /** @deprecated 선택 안내 문구는 더 이상 표시하지 않습니다. */
  description?: string
  lockAfterSelect?: boolean
  /** 브랜드가 없으면 첫 브랜드를 골라 바로 작업 화면을 연다. */
  autoSelectFirst?: boolean
}) {
  const { brands, brandBySlug, loading, error } = useCompanyBrandScope()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabActive = useWorkspaceTabActivity()
  const requested = searchParams.get('brand')?.trim() ?? ''
  const brand = requested ? brandBySlug.get(requested) : undefined
  const locked = lockAfterSelect && Boolean(brand)

  useEffect(() => {
    // 숨겨진 KeepAlive 탭이 주소를 바꾸면 보고 있던 탭이 튄다. 보이는 탭만 자동 선택한다.
    if (!tabActive || !autoSelectFirst || loading || error || requested) return
    const first = brands[0]
    if (!first) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (next.get('brand')) return prev
        next.set('brand', first.slug)
        return next
      },
      { replace: true },
    )
  }, [
    autoSelectFirst,
    brands,
    error,
    loading,
    requested,
    setSearchParams,
    tabActive,
  ])

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

  const statusMessage = loading ? (
    <p className="text-sm text-muted-foreground">브랜드를 불러오는 중...</p>
  ) : error ? (
    <p className="text-sm text-danger">브랜드 목록을 불러오지 못했습니다.</p>
  ) : brands.length === 0 ? (
    <p className="text-sm text-muted-foreground">
      등록된 브랜드가 없습니다. 브랜드 관리에서 먼저 만들어 주세요.
    </p>
  ) : null

  if (!brand) {
    if (autoSelectFirst) {
      return (
        <div className="py-10 text-center text-sm text-muted-foreground">
          {statusMessage ?? '브랜드를 불러오는 중...'}
        </div>
      )
    }
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-2 py-10 text-center sm:py-16">
        <p className="mb-6 text-lg text-muted-foreground sm:text-xl">{title}</p>
        {statusMessage ?? (
          <div className="grid w-full gap-3 sm:grid-cols-2">
            {brands.map((item) => (
              <BrandPickCard
                key={item.id}
                brand={item}
                selected={item.slug === requested}
                onSelect={selectBrand}
              />
            ))}
          </div>
        )}
        {requested && !loading ? (
          <p className="mt-4 text-sm text-danger">
            없는 브랜드입니다. 다시 고르세요.
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {statusMessage ??
          brands.map((item) => (
            <BrandSelectedChip
              key={item.id}
              brand={item}
              selected={item.slug === requested}
              disabled={locked && item.slug !== requested}
              onSelect={selectBrand}
            />
          ))}
      </div>
      <BrandScope brand={brand}>{children}</BrandScope>
    </div>
  )
}
