import { Select } from '@/components/ui/input'
import { useCompanyBrandScope } from './company-brand-scope'

export function CompanyBrandFilter({
  className,
}: {
  className?: string
}) {
  const { brands, selection, selectedBrands, setSelectedSlugs } =
    useCompanyBrandScope()
  if (brands.length === 0) return null

  const value =
    selection.isAll || selectedBrands.length !== 1
      ? 'all'
      : selectedBrands[0].slug

  return (
    <Select
      className={className}
      value={value}
      onChange={(event) => {
        const next = event.target.value
        setSelectedSlugs(next === 'all' ? brands.map((item) => item.slug) : [next])
      }}
    >
      <option value="all">전체 브랜드</option>
      {brands.map((item) => (
        <option key={item.id} value={item.slug}>
          {item.name}
        </option>
      ))}
    </Select>
  )
}
