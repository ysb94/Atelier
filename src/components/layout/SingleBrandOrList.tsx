import type { ReactNode } from 'react'
import { BrandScope } from './brand-context'
import { CompanyBrandFilter } from './CompanyBrandFilter'
import { useCompanyBrandScope } from './company-brand-scope'

/** 브랜드를 하나만 고르면 기존 상세 UI, 아니면 회사 목록. */
export function SingleBrandOrList({
  list,
  children,
}: {
  list: ReactNode
  children: ReactNode
}) {
  const { selection, selectedBrands } = useCompanyBrandScope()
  if (selection.canEdit && selectedBrands[0]) {
    return (
      <div>
        <div className="mb-3">
          <CompanyBrandFilter />
        </div>
        <BrandScope brand={selectedBrands[0]}>{children}</BrandScope>
      </div>
    )
  }
  return list
}
