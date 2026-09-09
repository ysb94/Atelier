import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { getBrands } from '@/lib/api'
import {
  resolveBrandSelection,
  serializeBrandSelection,
  type BrandSelection,
} from '@/lib/products/company-brand-filter'
import type { Brand } from '@/lib/types'

export type CompanyBrandScopeValue = {
  brands: Brand[]
  selectedBrands: Brand[]
  selection: BrandSelection
  brandById: Map<string, Brand>
  brandBySlug: Map<string, Brand>
  loading: boolean
  error: boolean
  setSelectedSlugs: (slugs: string[]) => void
}

const CompanyBrandScopeContext = createContext<CompanyBrandScopeValue | null>(
  null,
)

/**
 * 로딩 중 빈 배열은 매 렌더 새 참조가 되지 않게 고정한다.
 * 이 Provider 의 value 가 바뀌면 KeepAlive 로 숨겨진 탭까지 전부 다시 렌더된다.
 */
const EMPTY_BRANDS: Brand[] = []

export function CompanyBrandScopeProvider({ children }: { children: ReactNode }) {
  const brandsQuery = useQuery({
    queryKey: ['brands'],
    queryFn: getBrands,
  })
  const [searchParams, setSearchParams] = useSearchParams()
  const brands = brandsQuery.data ?? EMPTY_BRANDS
  const availableSlugs = useMemo(() => brands.map((item) => item.slug), [brands])
  const brandsParam = searchParams.get('brands')
  // 다른 검색 파라미터(page, brand, view …)가 바뀌어도 선택이 같으면 참조를 유지한다.
  const selection = useMemo(
    () => resolveBrandSelection(brandsParam, availableSlugs),
    [availableSlugs, brandsParam],
  )
  const selectedBrands = useMemo(
    () => brands.filter((item) => selection.slugs.includes(item.slug)),
    [brands, selection.slugs],
  )
  const brandById = useMemo(
    () => new Map(brands.map((item) => [item.id, item])),
    [brands],
  )
  const brandBySlug = useMemo(
    () => new Map(brands.map((item) => [item.slug, item])),
    [brands],
  )

  const setSelectedSlugs = useCallback(
    (slugs: string[]) => {
      const serialized = serializeBrandSelection(slugs, availableSlugs)
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (serialized == null) next.delete('brands')
          else next.set('brands', serialized)
          next.delete('page')
          return next
        },
        { replace: true },
      )
    },
    [availableSlugs, setSearchParams],
  )

  const value = useMemo<CompanyBrandScopeValue>(
    () => ({
      brands,
      selectedBrands,
      selection,
      brandById,
      brandBySlug,
      loading: brandsQuery.isLoading,
      error: brandsQuery.isError,
      setSelectedSlugs,
    }),
    [
      brandById,
      brandBySlug,
      brands,
      brandsQuery.isError,
      brandsQuery.isLoading,
      selectedBrands,
      selection,
      setSelectedSlugs,
    ],
  )

  return (
    <CompanyBrandScopeContext.Provider value={value}>
      {children}
    </CompanyBrandScopeContext.Provider>
  )
}

export function useCompanyBrandScope() {
  const ctx = useContext(CompanyBrandScopeContext)
  if (!ctx) {
    throw new Error('useCompanyBrandScope must be used within CompanyLayout')
  }
  return ctx
}

export function useOptionalCompanyBrandScope() {
  return useContext(CompanyBrandScopeContext)
}
