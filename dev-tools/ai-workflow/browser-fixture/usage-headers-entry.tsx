import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { BrandScope } from '@/components/layout/brand-context'
import { UsageCodePage } from '@/features/codes/UsageCodePage'
import '@/index.css'
const brand = {
  id: '20000000-0000-4000-8000-000000000001',
  slug: 'fixture',
  name: '검증 브랜드',
  nameKo: '검증 브랜드',
  color: '#333333',
} as any
const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity },
  },
})
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <BrowserRouter>
      <BrandScope brand={brand}>
        <UsageCodePage />
      </BrandScope>
    </BrowserRouter>
  </QueryClientProvider>,
)
