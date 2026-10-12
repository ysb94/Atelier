import { BrandTargetGate } from '@/components/layout/BrandTargetGate'
import { useRenderWatch } from '@/lib/diagnostics'
import { useInvoiceWorkController } from './useInvoiceWorkController'
import { InvoiceWorkView } from './InvoiceWorkView'

export function InvoiceWorkPage() {
  useRenderWatch('InvoiceWorkPage')
  const model = useInvoiceWorkController()
  return <InvoiceWorkView model={model} />
}

export function CompanyInvoiceWorkPage() {
  return (
    <BrandTargetGate lockAfterSelect>
      <InvoiceWorkPage />
    </BrandTargetGate>
  )
}
