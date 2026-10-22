import { useState } from 'react'
import { BrandTargetGate } from '@/components/layout/BrandTargetGate'
import { useRenderWatch } from '@/lib/diagnostics'
import { InvoiceWorkEntryBriefing } from './InvoiceWorkEntryBriefing'
import { useInvoiceWorkController } from './useInvoiceWorkController'
import { InvoiceWorkView } from './InvoiceWorkView'

export function InvoiceWorkPage() {
  useRenderWatch('InvoiceWorkPage')
  const model = useInvoiceWorkController()
  const [started, setStarted] = useState(false)
  if (!started) {
    return (
      <InvoiceWorkEntryBriefing
        brand={model.brand}
        onStart={() => setStarted(true)}
      />
    )
  }
  return <InvoiceWorkView model={model} />
}

export function CompanyInvoiceWorkPage() {
  return (
    <BrandTargetGate lockAfterSelect>
      <InvoiceWorkPage />
    </BrandTargetGate>
  )
}
