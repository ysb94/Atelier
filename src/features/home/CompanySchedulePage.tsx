import { PageHeader } from '@/components/layout/PageHeader'
import { HomeScheduleBoard } from './HomeScheduleBoard'

export function CompanySchedulePage() {
  return (
    <div>
      <PageHeader
        title="일정"
        description="회사 공통 일정입니다. 브랜드와 관계없이 같은 달력을 봅니다."
      />
      <HomeScheduleBoard events={[]} />
    </div>
  )
}
