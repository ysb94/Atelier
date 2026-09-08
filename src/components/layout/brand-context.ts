import { createContext, createElement, useContext, type ReactNode } from 'react'
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
  return createElement(
    BrandContext.Provider,
    { value: { brand, brandSlug: brand.slug } },
    children,
  )
}
