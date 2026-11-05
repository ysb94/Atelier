import { PageHeader } from '@/components/layout/PageHeader'
import { useRenderWatch } from '@/lib/diagnostics'

export function DutyFreePage() {
  useRenderWatch('DutyFreePage')
  return (
    <PageHeader
      title="면세"
      description="B2B 사업의 면세 화면입니다."
    />
  )
}
