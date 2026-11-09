import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Settings2, UserPlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { FilterTabs, type FilterTab } from '@/components/ui/filter-tabs'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tab-overlay'
import type { ChinaAssigneeWorkload } from '@/lib/supabase/china-assigned-work-orders'
import { CHINA_DEPARTMENT_ID, listChinaWorkAssignees, saveChinaWorkAssigneeOrder } from '@/lib/supabase/china-work-assignees'
import { draftPriceError } from '@/lib/supabase/draft-price-requests'
import { listOrgChartMembers, type OrgChartMember } from '@/lib/supabase/profiles'
import type { ProductDraft } from '@/lib/types'
import { cn, emptyList } from '@/lib/utils'
import { ChinaAssigneeManager } from './ChinaAssigneeManager'
import { ChinaMaterialRequests } from './ChinaMaterialRequests'
import { ChinaPriceRequests, type DraftPriceInputs } from './ChinaPriceRequests'
import { useDraftPriceRequests } from '@/features/drafts/useDraftPriceRequests'
import { useMaterialRequests } from '@/features/planning/useMaterialRequests'
import { materialAwaitingAssignment } from './china-material-workload'

type WorkTab = 'orders' | 'materials' | 'prices' | 'purchase' | 'outbound'
const NEW_ASSIGNEE = 'new'
const COMPLETED_MATERIALS = 'completed'

function insertionSide(tab: HTMLButtonElement, clientX: number) {
  const bounds = tab.getBoundingClientRect()
  return clientX < bounds.left + bounds.width / 2 ? 'before' : 'after'
}

const workTabs: { value: WorkTab; label: string }[] = [
  { value: 'orders', label: '작업 지시서' },
  { value: 'materials', label: '자재요청' },
  { value: 'prices', label: '단가요청' },
  { value: 'purchase', label: '발주서' },
  { value: 'outbound', label: '출고작업' },
]

export function ChinaWorkOrderTabs({ children, workloads, unchecked, unreceived, priceDrafts, brandById }: {
  children: (scope: { assigneeId: string | null }) => ReactNode
  workloads?: readonly ChinaAssigneeWorkload[]
  unchecked: ReadonlyMap<string, number>
  unreceived: number
  priceDrafts?: readonly ProductDraft[]
  brandById?: ReadonlyMap<string, { name: string }>
}) {
  const [workTab, setWorkTab] = useState<WorkTab>('orders')
  const [assigneeTab, setAssigneeTab] = useState(NEW_ASSIGNEE)
  const [materialAssigneeTab, setMaterialAssigneeTab] = useState(NEW_ASSIGNEE)
  const [priceInputs, setPriceInputs] = useState<DraftPriceInputs>({})
  const prices = useDraftPriceRequests('china')
  const pendingPrices = prices.requests.filter(request => !request.answeredAt).length
  const { requests: materialRequests } = useMaterialRequests('china', { refreshMs: 30_000 })
  const [managerMode, setManagerMode] = useState<'add' | 'manage' | null>(null)
  const dragged = useRef<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; side: 'before' | 'after' } | null>(null)
  const cache = useQueryClient()
  const assigneesQuery = useQuery({ queryKey: ['china-work-assignees'], queryFn: listChinaWorkAssignees })
  const membersQuery = useQuery({ queryKey: ['org-chart-members'], queryFn: () => listOrgChartMembers() })
  const assignees = assigneesQuery.data ?? emptyList<{ profileId: string; sortOrder: number }>()
  const move = useMutation({
    mutationFn: ({ from, to }: { from: number; to: number }) => {
      const expected = assignees.map(row => row.profileId)
      const ordered = expected.slice()
      const [profileId] = ordered.splice(from, 1)
      ordered.splice(to, 0, profileId)
      return saveChinaWorkAssigneeOrder(expected, ordered)
    },
    onSettled: () => cache.invalidateQueries({ queryKey: ['china-work-assignees'] }),
  })
  const members = membersQuery.data ?? emptyList<OrgChartMember>()
  const names = new Map(members.map(member => [member.id, member.displayName?.trim() ?? '']))
  const activeAssigneeIds = membersQuery.isSuccess
    ? new Set(members.filter(member => member.departmentId === CHINA_DEPARTMENT_ID).map(member => member.id))
    : null
  const workloadsById = new Map(workloads?.map(workload => [workload.profileId, workload]))
  const materialUnchecked = new Map<string, number>()
  const assigneeIds = new Set(assignees.map(row => row.profileId))
  let newMaterials = 0
  let unreadMaterials = 0
  let completedMaterials = 0
  for (const request of materialRequests) {
    if (request.status === '완료') {
      completedMaterials += 1
      continue
    }
    if (request.rounds.some(round => !round.reviewedAt && !round.shippedAt)) unreadMaterials += 1
    if (request.rounds.some(round => materialAwaitingAssignment(round, assigneeIds, activeAssigneeIds))) newMaterials += 1
    const unreadAssignees = new Set<string>()
    for (const round of request.rounds) {
      if (!round.assigneeId || !assigneeIds.has(round.assigneeId)
        || materialAwaitingAssignment(round, assigneeIds, activeAssigneeIds)) continue
      if (!round.shippedAt && !round.assigneeRead) unreadAssignees.add(round.assigneeId)
    }
    for (const person of unreadAssignees) {
      materialUnchecked.set(person, (materialUnchecked.get(person) ?? 0) + 1)
    }
  }
  const isMaterials = workTab === 'materials'
  const isPrices = workTab === 'prices'
  const showAssignees = workTab === 'orders' || isMaterials
  const workTabItems = workTabs.map(tab => {
    const unread = tab.value === 'orders' ? unreceived : tab.value === 'materials' ? unreadMaterials : tab.value === 'prices' ? pendingPrices : 0
    return unread > 0 ? { ...tab, aboveCount: unread } : tab
  })
  const assigneeTabs: FilterTab<string>[] = [
    { value: NEW_ASSIGNEE, label: isMaterials ? '새로운 자재요청' : '새로운 작업지시서', parenCount: isMaterials ? newMaterials : unreceived },
    ...assignees.map(row => {
      const pending = (isMaterials ? materialUnchecked : unchecked).get(row.profileId) ?? 0
      const label = names.get(row.profileId) || '담당자'
      const counts = workloadsById.get(row.profileId)
      const workload = counts && {
        open: isMaterials ? counts.materialOpen : counts.sampleOpen,
        resting: isMaterials ? counts.materialResting : counts.sampleResting,
        title: '진행 중 / 완료 대기',
      }
      return { value: row.profileId, label, ...(pending > 0 ? { aboveCount: pending } : {}), workload }
    }),
    ...(isMaterials ? [{ value: COMPLETED_MATERIALS, label: '완료 이력', parenCount: completedMaterials }] : []),
  ]
  const currentWork = workTabs.find(tab => tab.value === workTab)!
  const currentAssignee = assigneeTabs.find(tab => tab.value === (isMaterials ? materialAssigneeTab : assigneeTab)) ?? assigneeTabs[0]
  const showHistory = currentAssignee.value === COMPLETED_MATERIALS
  const selectedAssigneeId = currentAssignee.value === NEW_ASSIGNEE || showHistory ? null : currentAssignee.value

  function endDrag() {
    dragged.current = null
    setDropTarget(null)
  }

  async function replyPrice(requestId: string, amounts: Record<string, number>) {
    await prices.change({ action: 'reply', requestId, amounts })
    setPriceInputs(current => {
      const next = { ...current }
      delete next[requestId]
      return next
    })
  }

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
        {!isMaterials && !isPrices && <Badge variant="muted" className="self-start sm:self-center">화면 구성 미리보기</Badge>}
      </div>
      {showAssignees && (
        <div className="mt-2 flex min-w-0 items-stretch border-b border-border">
          <FilterTabs tabs={assigneeTabs} value={currentAssignee.value} onChange={isMaterials ? setMaterialAssigneeTab : setAssigneeTab} ariaLabel={isMaterials ? '자재요청 담당자' : '작업지시서 담당자'} variant="underline" className="min-w-0 flex-1 border-b-0"
            tabInteraction={profileId => {
              if (profileId === NEW_ASSIGNEE || profileId === COMPLETED_MATERIALS || assignees.length < 2 || managerMode || move.isPending) return
              const index = assignees.findIndex(row => row.profileId === profileId)
              return {
                draggable: true,
                title: '끌어서 순서 변경 · 키보드 Alt + 좌우 방향키',
                className: cn(
                  'relative cursor-grab active:cursor-grabbing',
                  dropTarget?.id === profileId && 'after:pointer-events-none after:absolute after:inset-y-1 after:z-10 after:w-0.5 after:rounded-full after:bg-primary',
                  dropTarget?.id === profileId && (dropTarget.side === 'before' ? 'after:left-0' : 'after:right-0'),
                ),
                onDragStart: event => {
                  dragged.current = profileId
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', names.get(profileId) ?? '담당자')
                },
                onDragOver: event => {
                  if (!dragged.current || dragged.current === profileId) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  const side = insertionSide(event.currentTarget, event.clientX)
                  setDropTarget(current => current?.id === profileId && current.side === side ? current : { id: profileId, side })
                },
                onDragLeave: event => {
                  if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
                  setDropTarget(current => current?.id === profileId ? null : current)
                },
                onDrop: event => {
                  if (!dragged.current) return
                  event.preventDefault()
                  const from = assignees.findIndex(row => row.profileId === dragged.current)
                  const boundary = index + (insertionSide(event.currentTarget, event.clientX) === 'after' ? 1 : 0)
                  const to = boundary - Number(from < boundary)
                  endDrag()
                  if (from >= 0 && from !== to) move.mutate({ from, to })
                },
                onDragEnd: endDrag,
                onKeyDown: event => {
                  if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
                  event.preventDefault()
                  const to = index + (event.key === 'ArrowLeft' ? -1 : 1)
                  if (to >= 0 && to < assignees.length) move.mutate({ from: index, to })
                },
              }
            }} />
          <button type="button" aria-label="담당자 추가" disabled={move.isPending} onClick={() => setManagerMode('add')} className="inline-flex shrink-0 items-center gap-1 border-b-2 border-transparent px-3 py-3 text-sm text-muted-foreground hover:text-foreground">
            <UserPlus className="size-4" aria-hidden="true" />
            추가
          </button>
          <button type="button" aria-label="담당자 삭제 관리" title="담당자 삭제 관리" disabled={move.isPending} onClick={() => setManagerMode('manage')} className="inline-flex shrink-0 items-center px-3 text-muted-foreground hover:text-foreground">
            <Settings2 className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}
      {showAssignees && move.error && <p role="alert" className="mt-2 text-sm text-danger">{move.error.message}</p>}
    </div>
    {managerMode && <WorkspaceTabOverlay>
      <ChinaAssigneeManager assignees={assignees} mode={managerMode} workloads={workloadsById} onClose={() => setManagerMode(null)} />
    </WorkspaceTabOverlay>}
    {workTab === 'orders' ? children({ assigneeId: selectedAssigneeId }) : workTab === 'materials'
      ? <ChinaMaterialRequests key={currentAssignee.value} selectedAssigneeId={selectedAssigneeId} showHistory={showHistory} activeAssigneeIds={assigneesQuery.isSuccess ? activeAssigneeIds : null}
        assignees={assignees.map(row => ({ id: row.profileId, name: names.get(row.profileId) || '담당자' }))} />
      : isPrices ? <ChinaPriceRequests requests={prices.requests} drafts={priceDrafts ?? emptyList<ProductDraft>()} brandById={brandById} inputs={priceInputs}
        loading={prices.query.isPending} error={prices.query.error ? draftPriceError(prices.query.error, '단가요청을 불러오지 못했습니다.') : ''}
        onRetry={() => { void prices.query.refetch() }} onReply={replyPrice}
        onEdit={(requestId, colorId, value) => setPriceInputs(current => ({ ...current, [requestId]: { ...current[requestId], [colorId]: value } }))} />
      : <Card className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <FileText className="size-8 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-base font-semibold">{currentWork.label}</h2>
      <p className="text-sm text-muted-foreground">{`${currentWork.label} 업무 화면을 준비 중입니다.`}</p>
    </Card>}
  </>
}
