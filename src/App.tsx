import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrandLayout } from '@/components/layout/BrandLayout'
import { BrandSelectPage } from '@/features/brands/BrandSelectPage'
import { ProductsPage } from '@/features/products/ProductsPage'
import { UploadPage } from '@/features/upload/UploadPage'
import { BarcodePage } from '@/features/codes/BarcodePage'
import { UsageCodePage } from '@/features/codes/UsageCodePage'
import { PartnerCodePage } from '@/features/codes/PartnerCodePage'
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

function ImportToUploadRedirect() {
  const { brandSlug } = useParams()
  return <Navigate to={`/b/${brandSlug}/upload`} replace />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<BrandSelectPage />} />
          <Route path="/b/:brandSlug" element={<BrandLayout />}>
            <Route index element={<Navigate to="products" replace />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="upload" element={<UploadPage />} />
            <Route path="import" element={<ImportToUploadRedirect />} />
            <Route path="barcodes" element={<BarcodePage />} />
            <Route path="usage-codes" element={<UsageCodePage />} />
            <Route path="partner-codes" element={<PartnerCodePage />} />
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
