import {
  createContext,
  createElement,
  useContext,
  useMemo,
  type ReactNode,
} from 'react'
import type { Brand } from '@/lib/types'

export type BrandContextValue = {
  brand: Brand
  brandSlug: string
}

export const BrandContext = createContext<BrandContextValue | null>(null)

export function useOptionalBrand() {
  return useContext(BrandContext)
}

export function useBrand() {
  const ctx = useOptionalBrand()
  if (!ctx) {
    throw new Error('useBrand must be used within BrandContext')
  }
  return ctx
}

export function BrandScope({
  brand,
  children,
}: {
  brand: Brand
  children: ReactNode
}) {
  // value 참조가 매 렌더 바뀌면 useBrand() 를 쓰는 무거운 페이지가 전부 다시 렌더된다.
  const value = useMemo<BrandContextValue>(
    () => ({ brand, brandSlug: brand.slug }),
    [brand],
  )
  return createElement(BrandContext.Provider, { value }, children)
}
