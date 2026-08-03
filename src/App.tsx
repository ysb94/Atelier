import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrandLayout } from '@/components/layout/BrandLayout'
import { BrandSelectPage } from '@/features/brands/BrandSelectPage'
import { ProductsPage } from '@/features/products/ProductsPage'
import { ImportPage } from '@/features/import/ImportPage'
import { PlanningPage } from '@/features/planning/PlanningPage'
import { DesignPage } from '@/features/design/DesignPage'
import { MdPage } from '@/features/md/MdPage'
import { LogisticsPage } from '@/features/logistics/LogisticsPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<BrandSelectPage />} />
          <Route path="/b/:brandSlug" element={<BrandLayout />}>
            <Route index element={<Navigate to="products" replace />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="planning" element={<PlanningPage />} />
            <Route path="design" element={<DesignPage />} />
            <Route path="md" element={<MdPage />} />
            <Route path="logistics" element={<LogisticsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
