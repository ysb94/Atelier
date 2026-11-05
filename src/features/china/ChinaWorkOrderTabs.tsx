import { useState, type ReactNode } from 'react'
import { FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { FilterTabs } from '@/components/ui/filter-tabs'

type WorkTab = 'orders' | 'prices' | 'purchase' | 'outbound'
type AssigneeTab = 'new' | 'kimran' | 'miyeon' | 'sucheol'

const workTabs: { value: WorkTab; label: string }[] = [
  { value: 'orders', label: '작업지시서' },
  { value: 'prices', label: '단가요청' },
  { value: 'purchase', label: '발주서' },
  { value: 'outbound', label: '출고작업' },
]

// Names follow the supplied layout draft. Assignment and unread totals are not
// connected in this UI preview, so no example counts are presented as real data.
const assigneeTabs: { value: AssigneeTab; label: string }[] = [
  { value: 'new', label: '새로운 작업지시서' },
  { value: 'kimran', label: '김란' },
  { value: 'miyeon', label: '미연' },
  { value: 'sucheol', label: '수철' },
]

export function ChinaWorkOrderTabs({ children }: { children: ReactNode }) {
  const [workTab, setWorkTab] = useState<WorkTab>('orders')
  const [assigneeTab, setAssigneeTab] = useState<AssigneeTab>('new')
  const currentWork = workTabs.find(tab => tab.value === workTab)!
  const currentAssignee = assigneeTabs.find(tab => tab.value === assigneeTab)!
  const showOrders = workTab === 'orders' && assigneeTab === 'new'

  return <>
    <div className="mb-5">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <FilterTabs tabs={workTabs} value={workTab} onChange={setWorkTab} ariaLabel="중국팀 업무" variant="underline" size="large" className="flex-1" />
        <Badge variant="muted" className="self-start sm:self-center">화면 구성 미리보기</Badge>
      </div>
      {workTab === 'orders' && <FilterTabs tabs={assigneeTabs} value={assigneeTab} onChange={setAssigneeTab} ariaLabel="작업지시서 담당자" variant="underline" className="mt-2 border-b-0" />}
    </div>
    {showOrders ? children : <Card className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <FileText className="size-8 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-base font-semibold">{workTab === 'orders' ? `${currentAssignee.label} 작업지시서` : currentWork.label}</h2>
      <p className="text-sm text-muted-foreground">{workTab === 'orders' ? '담당자별 작업 목록을 준비 중입니다.' : `${currentWork.label} 업무 화면을 준비 중입니다.`}</p>
    </Card>}
  </>
}
