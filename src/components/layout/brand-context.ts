import { createContext, useContext } from 'react'
import type { Brand } from '@/lib/types'

export type BrandContextValue = {
  brand: Brand
  brandSlug: string
}

export const BrandContext = createContext<BrandContextValue | null>(null)

export function useBrand() {
  const ctx = useContext(BrandContext)
  if (!ctx) throw new Error('useBrand must be used within BrandLayout')
  return ctx
}
