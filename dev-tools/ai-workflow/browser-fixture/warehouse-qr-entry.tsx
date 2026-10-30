import React from 'react'
import { createRoot } from 'react-dom/client'
import { WarehouseQrPanel } from '@/features/logistics/WarehouseQrPanel'
import '@/index.css'

createRoot(document.getElementById('root')!).render(<div className="mx-auto max-w-6xl p-6"><WarehouseQrPanel brandName="검증브랜드" /></div>)
