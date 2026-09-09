import type { ReactNode } from 'react'
import { BrandScope } from './brand-context'
import { BrandSelectedChip } from './brand-pick'
import { useCompanyBrandScope } from './company-brand-scope'

/** 브랜드를 하나만 고르면 기존 상세 UI, 아니면 회사 목록. */
export function SingleBrandOrList({
  list,
  children,
}: {
  list: ReactNode
  children: ReactNode
}) {
  const { brands, selection, selectedBrands, setSelectedSlugs } =
    useCompanyBrandScope()
  if (selection.canEdit && selectedBrands[0]) {
    const selectedSlug = selectedBrands[0].slug
    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {brands.length > 1 ? (
            <button
              type="button"
              aria-pressed={false}
              onClick={() => setSelectedSlugs(brands.map((item) => item.slug))}
              className="inline-flex items-center rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            >
              전체 브랜드
            </button>
          ) : null}
          {brands.map((item) => (
            <BrandSelectedChip
              key={item.id}
              brand={item}
              selected={item.slug === selectedSlug}
              onSelect={(slug) => setSelectedSlugs([slug])}
            />
          ))}
        </div>
        <BrandScope brand={selectedBrands[0]}>{children}</BrandScope>
      </div>
    )
  }
  return list
}
