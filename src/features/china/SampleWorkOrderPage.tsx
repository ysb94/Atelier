import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCompanyBrandScope } from '@/components/layout/company-brand-scope'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/PageHeader'
import { FilterBar } from '@/components/ui/filter-bar'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { Input } from '@/components/ui/input'
import '@/features/drafts/draft-board.css'
import { getCompanyProductDrafts } from '@/lib/api'
import { DEFAULT_COMPANY_ID } from '@/lib/company/capabilities'
import { useRenderWatch } from '@/lib/diagnostics'
import { resolveColorSampleRounds } from '@/lib/drafts/draft-flow'
import { sampleSentToChinaTeam } from '@/lib/drafts/sample-receipt'
import { colorSampleLabel, sampleOrderLabel } from '@/lib/drafts/sample-registration'
import {
  draftHasSampleWorkOrder,
  filledSampleWorkOrders,
  previousSampleFailReason,
} from '@/lib/drafts/sample-work-order'
import { useAuth } from '@/lib/supabase/auth'
import { getMyChinaWorkOrders, type ChinaAssigneeWorkload } from '@/lib/supabase/china-assigned-work-orders'
import { readPollInterval, sharedReadPolicy } from '@/lib/query/shared-read-policy'
import type { ProductDraft } from '@/lib/types'
import { emptyList, formatNumber } from '@/lib/utils'
import { ChinaWorkOrderTabs } from './ChinaWorkOrderTabs'
import { ChinaWorkOrderBoard } from './ChinaWorkOrderBoard'
import { ChinaAssignedWorkOrders } from './ChinaAssignedWorkOrders'
import type { WorkOrderGroup, WorkOrderRow } from './work-order-types'

type WorkOrderTab = 'all' | 'open' | 'done'

const WORK_ORDER_TABS: { value: WorkOrderTab; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'open', label: '샘플 요청' },
  { value: 'done', label: '종료' },
]

function workOrderFileName(name: string) {
  return name.trim() || '샘플 작업 지시서'
}

function closedRound(row: Pick<WorkOrderRow, 'shipped' | 'passed' | 'receivedAt'>) {
  return Boolean(row.shipped || row.passed || row.receivedAt)
}

function flattenDraftWorkOrders(draft: ProductDraft): WorkOrderRow[] {
  const allSamples = filledSampleWorkOrders(draft.sampleWorkOrders)
  const samples = allSamples.map((order) => ({
    china: sampleSentToChinaTeam(order.originCountry, draft.originCountry),
    row: {
      draft,
      kind: 'sample' as const,
      sampleStage: order.sampleStage,
      stageLabel: sampleOrderLabel(order, allSamples),
      rowId: order.id,
      url: order.url,
      fileName: workOrderFileName(order.name),
      shipped: Boolean(order.shipped),
      shippedAt: order.shippedAt,
      returnedAt: order.returnedAt,
      receivedAt: order.receivedAt ?? null,
      passed: Boolean(order.passed),
      failReason: order.failReason?.trim() ?? '',
      focusReason: previousSampleFailReason(draft.sampleWorkOrders, order.id),
      colorName: '',
      sortRound: order.round,
      assigneeId: order.assigneeId,
      assigneeName: order.assigneeName,
      fileCheckedAt: order.fileCheckedAt,
      assigneeCheckedAt: order.assigneeCheckedAt ?? null,
    },
  }))
  const colors = resolveColorSampleRounds(draft).map((round) => {
    const returned = Boolean(round.returnedAt || round.passed)
    return {
      china: sampleSentToChinaTeam(round.originCountry, draft.originCountry),
      row: {
        draft,
        kind: 'color' as const,
        stageLabel: colorSampleLabel(round.round),
        rowId: round.id,
        url: round.url,
        fileName: round.name.trim() || `${round.round}차 컬러 샘플 작업 지시서`,
        shipped: returned,
        shippedAt: round.shippedAt ?? draft.specs.colorSampleRequestedAt ?? null,
        returnedAt: round.returnedAt,
        receivedAt: round.receivedAt ?? null,
        passed: round.passed,
        failReason: '',
        focusReason: '',
        colorName: '',
        sortRound: round.round,
        assigneeId: round.assigneeId ?? null,
        assigneeName: round.assigneeName ?? '',
        fileCheckedAt: round.fileCheckedAt ?? null,
        assigneeCheckedAt: round.assigneeCheckedAt ?? null,
      },
    }
  })
  const rounds = [...samples, ...colors]
  if (!rounds.some((item) => item.china)) return []
  return rounds.filter((item) => item.china || closedRound(item.row)).map((item) => item.row)
}

function isWorkOrderDone(row: Pick<WorkOrderRow, 'shipped' | 'passed' | 'receivedAt'>) {
  return closedRound(row)
}

function matchesListTab(row: WorkOrderRow, tab: WorkOrderTab) {
  if (tab === 'all') return true
  if (tab === 'done') return isWorkOrderDone(row)
  return !isWorkOrderDone(row)
}

function assignmentTime(value: string | null | undefined) {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : time
}

function roundHandedOff(row: WorkOrderRow, assignedAt: string | null | undefined) {
  const assigned = assignmentTime(assignedAt)
  if (assigned == null) return false
  const arrived = assignmentTime(row.shippedAt)
  return arrived == null || arrived <= assigned
}

function groupWorkOrders(rows: readonly WorkOrderRow[]): WorkOrderGroup[] {
  const groups = new Map<string, WorkOrderGroup>()
  for (const row of rows) {
    const group = groups.get(row.draft.id)
    if (group) group.rows.push(row)
    else groups.set(row.draft.id, { draft: row.draft, rows: [row] })
  }
  for (const group of groups.values()) group.rows.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'sample' ? -1 : 1
    const stage = Number(left.sampleStage === 'final') - Number(right.sampleStage === 'final')
    return stage || left.sortRound - right.sortRound || left.rowId.localeCompare(right.rowId)
  })
  return [...groups.values()].sort((left, right) => right.draft.updatedAt.localeCompare(left.draft.updatedAt))
}

function assigneeUncheckedPlans(groups: readonly WorkOrderGroup[]) {
  const counts = new Map<string, number>()
  for (const group of groups) {
    const assignment = group.draft.specs.chinaWorkAssignment
    const assigneeId = assignment?.assigneeId
    if (!assigneeId || group.draft.status === 'confirmed') continue
    const pending = group.rows.some(row => row.assigneeId === assigneeId && roundHandedOff(row, assignment.assignedAt) && Boolean(row.url) && !isWorkOrderDone(row) && !row.assigneeCheckedAt)
    if (!pending) continue
    counts.set(assigneeId, (counts.get(assigneeId) ?? 0) + 1)
  }
  return counts
}

function unreceivedWorkOrders(groups: readonly WorkOrderGroup[]) {
  return groups.reduce((sum, group) => sum + group.rows.filter(row => !isWorkOrderDone(row) && Boolean(row.url) && !row.fileCheckedAt).length, 0)
}

export function CompanySampleWorkOrderPage() {
  useRenderWatch('CompanySampleWorkOrderPage')
  const { profile, session } = useAuth()
  const { brandById } = useCompanyBrandScope()
  const active = useWorkspaceTabActivity()
  const accountId = session?.user.id
  const enabled = Boolean(accountId && profile?.id === accountId && profile.status === 'active')
  const screen = useQuery({
    queryKey: ['china-work-screen', accountId],
    queryFn: getMyChinaWorkOrders,
    ...sharedReadPolicy,
    enabled,
    refetchInterval: readPollInterval(30_000, active && enabled),
  })
  if (enabled && !screen.isError && screen.data?.role === 'manager') return <ChinaManagedWorkOrders key={accountId}
    revision={screen.data.revision} workloads={screen.data.workloads} />
  if (enabled && !screen.isError && accountId && screen.data?.role === 'worker') {
    return <ChinaAssignedWorkOrders key={accountId} accountId={accountId} orders={screen.data.orders} brandById={brandById} />
  }
  return <div>
    <PageHeader title="중국 업무" />
    {screen.isError ? <p role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
      중국 업무를 불러오지 못했습니다.
      <Button type="button" size="sm" variant="outline" onClick={() => void screen.refetch()}>다시 조회</Button>
    </p> : <p role="status" className="text-sm text-muted-foreground">{screen.data?.role === 'denied' ? '중국 업무를 볼 수 있는 계정이 아닙니다.' : '중국 업무를 불러오는 중입니다.'}</p>}
  </div>
}

function ChinaManagedWorkOrders({ revision, workloads }: { revision?: string | null; workloads?: readonly ChinaAssigneeWorkload[] }) {
  useRenderWatch('ChinaManagedWorkOrders')
  const { brandById } = useCompanyBrandScope()
  const { profile } = useAuth()
  const [search, setSearch] = useState('')
  const [listTab, setListTab] = useState<WorkOrderTab>('all')
  const companyId = profile?.companyId ?? DEFAULT_COMPANY_ID
  const cache = useQueryClient()
  const previousRevision = useRef(revision)
  useEffect(() => {
    if (previousRevision.current === revision) return
    previousRevision.current = revision
    void cache.invalidateQueries({ queryKey: ['product-drafts', 'company', companyId], exact: true })
  }, [cache, companyId, revision])

  const draftsQuery = useQuery({
    queryKey: ['product-drafts', 'company', companyId],
    queryFn: () => getCompanyProductDrafts(companyId),
  })
  const workOrderGroups = useMemo(() => groupWorkOrders(
    (draftsQuery.data ?? emptyList<ProductDraft>())
      .filter(draftHasSampleWorkOrder).flatMap(flattenDraftWorkOrders),
  ), [draftsQuery.data])
  const unchecked = useMemo(() => assigneeUncheckedPlans(workOrderGroups), [workOrderGroups])
  const unreceived = useMemo(() => unreceivedWorkOrders(workOrderGroups), [workOrderGroups])
  const visibleGroups = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return workOrderGroups.flatMap(group => {
      if (group.draft.status === 'confirmed' && listTab !== 'done') return []
      const matched = group.rows.filter(row => matchesListTab(row, listTab))
      if (matched.length === 0) return []
      const rows = listTab === 'open'
        ? group.rows.filter(row => isWorkOrderDone(row) || matchesListTab(row, listTab))
        : matched
      const matchesKeyword = !keyword || [
        group.draft.draftNo, group.draft.nameKo, group.draft.nameEn, group.draft.owner,
        ...rows.flatMap(row => [row.fileName, row.colorName]),
        ...group.draft.colors.map(color => color.name),
      ].some(value => value.toLowerCase().includes(keyword))
      return matchesKeyword ? [{ ...group, rows }] : []
    })
  }, [workOrderGroups, listTab, search])

  return (
    <div>
      <PageHeader
        title="중국 업무"
        description="같은 상품의 샘플 회차를 한 묶음으로 표시합니다. 발송하면 기획안 회차에 발송일이 남습니다."
      />

      <ChinaWorkOrderTabs workloads={workloads} unchecked={unchecked} unreceived={unreceived}>
      {({ assigneeId }) => {
      const scopedGroups = visibleGroups.flatMap(group => {
        const assignment = group.draft.specs.chinaWorkAssignment
        const assignedTo = assignment?.assigneeId ?? ''
        const pending = group.rows.some(row => !roundHandedOff(row, assignedTo ? assignment?.assignedAt : null))
        if (!assigneeId) return assignedTo && !pending ? [] : [group]
        if (assignedTo !== assigneeId) return []
        const rows = group.rows.filter(row => roundHandedOff(row, assignment?.assignedAt))
        return rows.length ? [{ ...group, rows }] : []
      })
      const scopedRounds = scopedGroups.reduce((count, group) => count + group.rows.length, 0)
      return <>
      <FilterBar>
        <Input
          className="sm:max-w-xs"
          placeholder="PL번호, 이름, 파일명, 컬러 검색..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <FilterTabs tabs={WORK_ORDER_TABS} value={listTab} onChange={setListTab} ariaLabel="작업 지시서 상태" />
        <div className="text-sm text-muted-foreground sm:ml-auto">
          {formatNumber(scopedGroups.length)}상품 · {formatNumber(scopedRounds)}회차
        </div>
        <Button type="button" variant="outline" size="sm" disabled={draftsQuery.isFetching} onClick={() => {
          void draftsQuery.refetch()
          void cache.invalidateQueries({ queryKey: ['china-work-screen'] })
        }}>새로고침</Button>
      </FilterBar>

      {draftsQuery.isError ? (
        <p className="mb-3 text-sm text-danger">
          작업 지시서를 불러오지 못했습니다.
        </p>
      ) : null}
      <ChinaWorkOrderBoard groups={scopedGroups} brandById={brandById} emptyMessage={
        draftsQuery.isLoading ? '불러오는 중...' : draftsQuery.isError ? '작업 지시서를 불러오지 못했습니다.' : search.trim() ? '조건에 맞는 상품이 없습니다.' : assigneeId ? '이 담당자에게 배정된 작업 지시서가 없습니다.' : '기획안에 등록된 작업 지시서가 여기에 상품별로 나타납니다.'
      } />
      </>
      }}
      </ChinaWorkOrderTabs>
    </div>
  )
}
