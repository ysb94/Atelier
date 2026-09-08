import { Outlet } from 'react-router-dom'
import { ProductsPage } from '@/features/products/ProductsPage'
import { useCompanyBrandScope } from '@/components/layout/company-brand-scope'

export function CompanyProductsPage() {
  const scope = useCompanyBrandScope()

  if (scope.loading) {
    return (
      <div>
        <p className="text-sm text-muted-foreground">브랜드를 불러오는 중...</p>
        <Outlet />
      </div>
    )
  }

  if (scope.error) {
    return (
      <p className="text-sm text-danger">브랜드 목록을 불러오지 못했습니다.</p>
    )
  }

  return <ProductsPage companyBrands={scope.brands} />
}
