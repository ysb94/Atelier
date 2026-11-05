import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCompanyBrandScope } from '@/components/layout/company-brand-scope'
import { PageHeader } from '@/components/layout/PageHeader'
import { FilterBar } from '@/components/ui/filter-bar'
import { Input, Select } from '@/components/ui/input'
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
import type { ProductDraft } from '@/lib/types'
import { emptyList, formatNumber } from '@/lib/utils'
import { ChinaWorkOrderTabs } from './ChinaWorkOrderTabs'
import { ChinaWorkOrderBoard } from './ChinaWorkOrderBoard'
import type { WorkOrderGroup, WorkOrderRow } from './work-order-types'

type WorkOrderTab = 'open' | 'color' | 'done'

const WORK_ORDER_TABS: { value: WorkOrderTab; label: string }[] = [
  { value: 'open', label: '샘플 요청' },
  { value: 'color', label: '컬러별 샘플 요청' },
  { value: 'done', label: '종료' },
]

function workOrderFileName(name: string) {
  return name.trim() || '샘플 작업 지시서'
}

function flattenDraftWorkOrders(draft: ProductDraft): WorkOrderRow[] {
  const allSamples = filledSampleWorkOrders(draft.sampleWorkOrders)
  const samples = allSamples.filter(order => sampleSentToChinaTeam(order.originCountry, draft.originCountry)).map(
    (order) => ({
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
      passed: Boolean(order.passed),
      failReason: order.failReason?.trim() ?? '',
      focusReason: previousSampleFailReason(draft.sampleWorkOrders, order.id),
      colorName: '',
      sortRound: order.round,
      assigneeId: order.assigneeId,
      assigneeName: order.assigneeName,
      fileCheckedAt: order.fileCheckedAt,
    }),
  )
  const colorRounds = resolveColorSampleRounds(draft)
  const colorNames = draft.colors.map((color) => color.name.trim()).filter(Boolean).join(', ')
  const colors = colorRounds.filter(round => !(round.originCountry || draft.originCountry) || /중국|china/i.test(round.originCountry || draft.originCountry)).map((round) => {
    const returned = Boolean(round.returnedAt || round.passed)
    return {
      draft,
      kind: 'color' as const,
      stageLabel: colorSampleLabel(round.round),
      rowId: round.id,
      url: round.url,
      fileName: round.name.trim() || `${round.round}차 컬러 샘플 작업 지시서`,
      shipped: returned,
      shippedAt: round.shippedAt ?? draft.specs.colorSampleRequestedAt ?? null,
      returnedAt: round.returnedAt,
      passed: round.passed,
      failReason: '',
      focusReason: '',
      colorName: colorNames,
      sortRound: round.round,
      assigneeId: null,
      assigneeName: '',
      fileCheckedAt: null,
    }
  })
  return [...samples, ...colors]
}

function isWorkOrderDone(row: Pick<WorkOrderRow, 'kind' | 'shipped' | 'passed'>) {
  return row.kind === 'color' ? row.shipped : Boolean(row.shipped || row.passed)
}

function isOpenSampleRequest(row: WorkOrderRow) {
  return row.kind === 'sample' && !isWorkOrderDone(row)
}

function isOpenColorRequest(row: WorkOrderRow) {
  return row.kind === 'color' && !isWorkOrderDone(row)
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

export function CompanySampleWorkOrderPage() {
  useRenderWatch('CompanySampleWorkOrderPage')
  const { brandById } = useCompanyBrandScope()
  const { profile } = useAuth()
  const [search, setSearch] = useState('')
  const [listTab, setListTab] = useState<WorkOrderTab>('open')
  const companyId = profile?.companyId ?? DEFAULT_COMPANY_ID

  const draftsQuery = useQuery({
    queryKey: ['product-drafts', 'company', companyId],
    queryFn: () => getCompanyProductDrafts(companyId),
  })
  const workOrderGroups = useMemo(() => groupWorkOrders(
    (draftsQuery.data ?? emptyList<ProductDraft>())
      .filter(draftHasSampleWorkOrder).flatMap(flattenDraftWorkOrders),
  ), [draftsQuery.data])
  const visibleGroups = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return workOrderGroups.filter(group => {
      const matchesStatus = group.rows.some(row => listTab === 'done' ? isWorkOrderDone(row) : listTab === 'color' ? isOpenColorRequest(row) : isOpenSampleRequest(row))
      if (!matchesStatus) return false
      return !keyword || group.rows.some(row => [
        group.draft.draftNo, group.draft.nameKo, group.draft.nameEn,
        group.draft.owner, row.fileName, row.colorName,
        ...group.draft.colors.map(color => color.name),
      ].some(value => value.toLowerCase().includes(keyword)))
    })
  }, [workOrderGroups, listTab, search])
  const visibleRounds = visibleGroups.reduce((count, group) => count + group.rows.length, 0)

  return (
    <div>
      <PageHeader
        title="작업 지시서"
        description="같은 상품의 샘플 회차를 한 묶음으로 표시합니다. 담당자 지정·받기·발송·업무배정 버튼은 화면 확인용입니다."
      />

      <ChinaWorkOrderTabs>
      <FilterBar>
        <Input
          className="sm:max-w-xs"
          placeholder="PL번호, 이름, 파일명, 컬러 검색..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select aria-label="작업 지시서 상태" className="sm:w-48" value={listTab} onChange={event => setListTab(event.target.value as WorkOrderTab)}>
          {WORK_ORDER_TABS.map(tab => <option key={tab.value} value={tab.value}>{tab.label}</option>)}
        </Select>
        <div className="text-sm text-muted-foreground sm:ml-auto">
          {formatNumber(visibleGroups.length)}상품 · {formatNumber(visibleRounds)}회차
        </div>
      </FilterBar>

      {draftsQuery.isError ? (
        <p className="mb-3 text-sm text-danger">
          작업 지시서를 불러오지 못했습니다.
        </p>
      ) : null}
      <ChinaWorkOrderBoard groups={visibleGroups} brandById={brandById} emptyMessage={
        draftsQuery.isLoading ? '불러오는 중...' : draftsQuery.isError ? '작업 지시서를 불러오지 못했습니다.' : search.trim() ? '조건에 맞는 상품이 없습니다.' : '기획안에 등록된 작업 지시서가 여기에 상품별로 나타납니다.'
      } />
      </ChinaWorkOrderTabs>
    </div>
  )
}
