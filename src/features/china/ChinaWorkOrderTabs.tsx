import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, UserPlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { listChinaWorkAssignees } from '@/lib/supabase/china-work-assignees'
import { listOrgChartMembers, type OrgChartMember } from '@/lib/supabase/profiles'
import { emptyList } from '@/lib/utils'
import { ChinaAssigneeManager } from './ChinaAssigneeManager'

type WorkTab = 'orders' | 'prices' | 'purchase' | 'outbound'
const NEW_ASSIGNEE = 'new'

const workTabs: { value: WorkTab; label: string }[] = [
  { value: 'orders', label: '작업 지시서' },
  { value: 'prices', label: '단가요청' },
  { value: 'purchase', label: '발주서' },
  { value: 'outbound', label: '출고작업' },
]

export function ChinaWorkOrderTabs({ children, workloads, unreceived }: { children: (scope: { assigneeId: string | null }) => ReactNode; workloads: ReadonlyMap<string, { open: number; resting: number }>; unreceived: number }) {
  const [workTab, setWorkTab] = useState<WorkTab>('orders')
  const [assigneeTab, setAssigneeTab] = useState(NEW_ASSIGNEE)
  const [managerOpen, setManagerOpen] = useState(false)
  const assigneesQuery = useQuery({ queryKey: ['china-work-assignees'], queryFn: listChinaWorkAssignees })
  const membersQuery = useQuery({ queryKey: ['org-chart-members'], queryFn: () => listOrgChartMembers() })
  const assignees = assigneesQuery.data ?? emptyList<{ profileId: string; sortOrder: number }>()
  const names = new Map((membersQuery.data ?? emptyList<OrgChartMember>()).map(member => [member.id, member.displayName?.trim() ?? '']))
  const workTabItems = workTabs.map(tab => tab.value === 'orders' ? { ...tab, aboveCount: unreceived } : tab)
  const assigneeTabs = [
    { value: NEW_ASSIGNEE, label: '새로운 작업지시서', parenCount: unreceived },
    ...assignees.map(row => ({ value: row.profileId, label: names.get(row.profileId) || '담당자', workload: workloads.get(row.profileId) ?? { open: 0, resting: 0 } })),
  ]
  const currentWork = workTabs.find(tab => tab.value === workTab)!
  const currentAssignee = assigneeTabs.find(tab => tab.value === assigneeTab) ?? assigneeTabs[0]
  const ordersAssigneeId = assigneeTab === NEW_ASSIGNEE ? null : currentAssignee.value

  useEffect(() => {
    if (assigneesQuery.error) console.warn('[china-assignees] 담당자 목록 조회 실패', { code: 'query' })
  }, [assigneesQuery.error])
  useEffect(() => {
    if (!assignees.some(row => row.profileId === assigneeTab) && assigneeTab !== NEW_ASSIGNEE) setAssigneeTab(NEW_ASSIGNEE)
  }, [assignees, assigneeTab])

  return <>
    <div className="mb-5">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <FilterTabs tabs={workTabItems} value={workTab} onChange={setWorkTab} ariaLabel="중국팀 업무" variant="underline" size="large" className="flex-1" />
        <Badge variant="muted" className="self-start sm:self-center">화면 구성 미리보기</Badge>
      </div>
      {workTab === 'orders' && (
        <div className="mt-2 flex min-w-0 items-stretch border-b border-border">
          <FilterTabs tabs={assigneeTabs} value={currentAssignee.value} onChange={setAssigneeTab} ariaLabel="작업지시서 담당자" variant="underline" className="min-w-0 flex-1 border-b-0" />
          <button type="button" aria-label="담당자 추가" onClick={() => setManagerOpen(true)} className="inline-flex shrink-0 items-center gap-1 border-b-2 border-transparent px-4 py-3 text-sm text-muted-foreground hover:text-foreground">
            <UserPlus className="size-4" aria-hidden="true" />
            추가
          </button>
        </div>
      )}
    </div>
    {managerOpen ? <ChinaAssigneeManager assignees={assignees} onClose={() => setManagerOpen(false)} /> : null}
    {workTab === 'orders' ? children({ assigneeId: ordersAssigneeId }) : <Card className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <FileText className="size-8 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-base font-semibold">{currentWork.label}</h2>
      <p className="text-sm text-muted-foreground">{`${currentWork.label} 업무 화면을 준비 중입니다.`}</p>
    </Card>}
  </>
}
