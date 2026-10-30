import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WarehouseSlotSettingsPanel } from '@/features/logistics/WarehouseSlotSettingsPanel'
import type { WarehouseZone } from '@/lib/types'
import '@/index.css'

const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
export function Fixture() {
  const [zone, setZone] = useState<WarehouseZone>('picking')
  return <QueryClientProvider client={client}><div className="mx-auto max-w-6xl space-y-4 p-6">
    <div><button onClick={() => setZone('picking')}>출고창고 검증</button><button onClick={() => setZone('box_storage')}>박스창고 검증</button></div>
    <WarehouseSlotSettingsPanel brandId="fixture-brand" warehouseLabel={zone === 'picking' ? '출고창고' : '박스창고'} zone={zone} />
  </div></QueryClientProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
