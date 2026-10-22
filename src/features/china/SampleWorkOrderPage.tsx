import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, Check, Download, FileText } from 'lucide-react'
import { useCompanyBrandScope } from '@/components/layout/company-brand-scope'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FilterBar } from '@/components/ui/filter-bar'
import { Input, Select } from '@/components/ui/input'
import { DraftPhoto } from '@/features/drafts/DraftSheetRow'
import '@/features/drafts/draft-board.css'
import { getCompanyProductDrafts, updateProductDraft } from '@/lib/api'
import { DEFAULT_COMPANY_ID } from '@/lib/company/capabilities'
import { useRenderWatch } from '@/lib/diagnostics'
import {
  colorWorkOrderFileName,
  filledColorWorkOrders,
  markLatestColorSampleReturned,
  resolveColorSampleRounds,
  setColorWorkOrderShipped,
} from '@/lib/drafts/draft-flow'
import {
  draftHasSampleWorkOrder,
  draftStatePercent,
  draftToInput,
  filledSampleWorkOrders,
  legacyWorkOrderFields,
  previousSampleFailReason,
  sampleElapsedDaysLabel,
  setSampleWorkOrderAssignee,
  setSampleWorkOrderFileChecked,
  setSampleWorkOrderShipped,
  sheetDay,
} from '@/lib/drafts/sample-work-order'
import { useAuth } from '@/lib/supabase/auth'
import { listDepartments, listOrgChartMembers } from '@/lib/supabase/profiles'
import type { ProductDraft } from '@/lib/types'
import { cn, emptyList, formatNumber } from '@/lib/utils'

type WorkOrderTab = 'open' | 'color' | 'price' | 'done'

const WORK_ORDER_TABS: { value: WorkOrderTab; label: string }[] = [
  { value: 'open', label: '샘플 요청' },
  { value: 'color', label: '컬러별 샘플 요청' },
  { value: 'price', label: '단가 요청' },
  { value: 'done', label: '종료' },
]

function workOrderFileName(name: string) {
  return name.trim() || '샘플 작업 지시서'
}

type WorkOrderKind = 'sample' | 'color'

type WorkOrderRow = {
  draft: ProductDraft
  kind: WorkOrderKind
  orderId: string
  url: string | null
  fileName: string
  shipped: boolean
  shippedAt: string | null
  passed: boolean
  failReason: string
  focusReason: string
  colorName: string
  sortRound: number
  assigneeId: string | null
  assigneeName: string
  fileCheckedAt: string | null
}

function flattenDraftWorkOrders(draft: ProductDraft): WorkOrderRow[] {
  const samples = filledSampleWorkOrders(draft.sampleWorkOrders).map(
    (order) => ({
      draft,
      kind: 'sample' as const,
      orderId: order.id,
      url: order.url,
      fileName: workOrderFileName(order.name),
      shipped: Boolean(order.shipped),
      shippedAt: order.shippedAt,
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
  const latestColorRound = colorRounds[colorRounds.length - 1]
  const sentColorRound = [...colorRounds].reverse().find((round) => round.shippedAt) ?? latestColorRound
  const colors = filledColorWorkOrders(draft.colors)
    .filter((color, index, list) => {
      const url = color.sampleWorkOrderUrl?.trim()
      return list.findIndex((item) => item.sampleWorkOrderUrl?.trim() === url) === index
    })
    .map((color) => ({
    draft,
    kind: 'color' as const,
    orderId: color.id,
    url: color.sampleWorkOrderUrl,
    fileName: colorWorkOrderFileName(color),
    shipped: Boolean(color.sampleWorkOrderShipped),
    shippedAt: sentColorRound?.shippedAt ?? draft.specs.colorSampleRequestedAt ?? null,
    passed: Boolean(latestColorRound?.passed),
    failReason: '',
    focusReason: '',
    colorName: color.name.trim(),
    sortRound: sentColorRound?.round ?? 1,
    assigneeId: null,
    assigneeName: '',
    fileCheckedAt: null,
  }))
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

function formatSavedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function isChinaDepartment(name: string) {
  const key = name.replace(/\s/g, '').toLowerCase()
  return key === 'china' || key.includes('중국')
}

export function CompanySampleWorkOrderPage() {
  useRenderWatch('CompanySampleWorkOrderPage')
  const { brandById } = useCompanyBrandScope()
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [listTab, setListTab] = useState<WorkOrderTab>('open')
  const companyId = profile?.companyId ?? DEFAULT_COMPANY_ID

  const draftsQuery = useQuery({
    queryKey: ['product-drafts', 'company', companyId],
    queryFn: () => getCompanyProductDrafts(companyId),
  })
  const departmentsQuery = useQuery({
    queryKey: ['departments', 'active'],
    queryFn: () => listDepartments(true),
  })
  const membersQuery = useQuery({
    queryKey: ['orgChartMembers'],
    queryFn: () => listOrgChartMembers(),
  })
  const chinaStaff = useMemo(() => {
    const departments = departmentsQuery.data ?? emptyList<{ id: string; name: string }>()
    const chinaIds = new Set(
      departments.filter((department) => isChinaDepartment(department.name)).map((department) => department.id),
    )
    return (membersQuery.data ?? emptyList<{ id: string; displayName: string | null; departmentId: string | null }>())
      .filter((member) => member.departmentId && chinaIds.has(member.departmentId))
      .sort((left, right) => (left.displayName ?? '').localeCompare(right.displayName ?? '', 'ko'))
  }, [departmentsQuery.data, membersQuery.data])

  const shipMutation = useMutation({
    mutationFn: async ({
      draft,
      kind,
      orderId,
    }: {
      draft: ProductDraft
      kind: WorkOrderKind
      orderId: string
    }) => {
      const input = draftToInput(draft)
      if (kind === 'color') {
        const returnedAt = new Date().toISOString()
        const colors = setColorWorkOrderShipped(input.colors, orderId, true, returnedAt)
        const colorSampleRounds = markLatestColorSampleReturned(
          resolveColorSampleRounds({ ...draft, colors: input.colors }),
          returnedAt,
        )
        return updateProductDraft(draft.id, {
          ...input,
          colors,
          specs: { ...input.specs, colorSampleRounds },
        })
      }
      const sampleWorkOrders = setSampleWorkOrderShipped(
        input.sampleWorkOrders,
        orderId,
        true,
      )
      return updateProductDraft(draft.id, {
        ...input,
        sampleWorkOrders,
        ...legacyWorkOrderFields(sampleWorkOrders),
      })
    },
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['product-drafts', 'company', companyId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['product-draft', updated.id],
        }),
      ])
    },
  })

  const assignMutation = useMutation({
    mutationFn: async ({
      draft,
      orderId,
      assigneeId,
      assigneeName,
    }: {
      draft: ProductDraft
      orderId: string
      assigneeId: string | null
      assigneeName: string
    }) => {
      const input = draftToInput(draft)
      const sampleWorkOrders = setSampleWorkOrderAssignee(
        input.sampleWorkOrders,
        orderId,
        assigneeId,
        assigneeName,
      )
      return updateProductDraft(draft.id, {
        ...input,
        sampleWorkOrders,
        ...legacyWorkOrderFields(sampleWorkOrders),
      })
    },
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['product-drafts', 'company', companyId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['product-draft', updated.id],
        }),
      ])
    },
  })

  const checkMutation = useMutation({
    mutationFn: async ({
      draft,
      orderId,
    }: {
      draft: ProductDraft
      orderId: string
    }) => {
      const input = draftToInput(draft)
      const sampleWorkOrders = setSampleWorkOrderFileChecked(
        input.sampleWorkOrders,
        orderId,
      )
      return updateProductDraft(draft.id, {
        ...input,
        sampleWorkOrders,
        ...legacyWorkOrderFields(sampleWorkOrders),
      })
    },
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['product-drafts', 'company', companyId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['product-draft', updated.id],
        }),
      ])
    },
  })

  function downloadWorkOrder(row: WorkOrderRow) {
    if (!row.url) return
    const link = document.createElement('a')
    link.href = row.url
    link.download = row.fileName
    link.rel = 'noreferrer'
    link.click()
    if (row.kind === 'sample' && !row.fileCheckedAt) {
      checkMutation.mutate({ draft: row.draft, orderId: row.orderId })
    }
  }

  const workOrders = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return (draftsQuery.data ?? [])
      .filter((draft) => draftHasSampleWorkOrder(draft))
      .flatMap((draft) => flattenDraftWorkOrders(draft))
      .filter((row) => {
        if (!keyword) return true
        return [
          row.draft.draftNo,
          row.draft.nameKo,
          row.draft.nameEn,
          row.draft.owner,
          row.fileName,
          row.colorName,
          ...row.draft.colors.map((color) => color.name),
        ]
          .filter(Boolean)
          .some((text) => text.toLowerCase().includes(keyword))
      })
      .sort((left, right) => {
        const byTime = right.draft.updatedAt.localeCompare(left.draft.updatedAt)
        if (byTime !== 0) return byTime
        if (left.kind !== right.kind) return left.kind === 'sample' ? -1 : 1
        if (left.kind === 'sample') return right.sortRound - left.sortRound
        return left.colorName.localeCompare(right.colorName, 'ko')
      })
  }, [draftsQuery.data, search])

  const tabCounts = useMemo(
    () => ({
      open: workOrders.filter((row) => isOpenSampleRequest(row) && !row.fileCheckedAt).length,
      color: workOrders.filter(isOpenColorRequest).length,
      price: 0,
      done: workOrders.filter((row) => isWorkOrderDone(row)).length,
    }),
    [workOrders],
  )
  const visibleWorkOrders = useMemo(
    () => {
      if (listTab === 'price') return []
      if (listTab === 'done') return workOrders.filter(isWorkOrderDone)
      if (listTab === 'color') return workOrders.filter(isOpenColorRequest)
      return workOrders.filter(isOpenSampleRequest)
    },
    [listTab, workOrders],
  )

  return (
    <div>
      <PageHeader
        title="작업 지시서"
        description="기획에서 올리고 저장한 대표 샘플·컬러별 작업 지시서입니다. 지시서 하나마다 행이 생기고, 이미 발송한 행은 그대로 완료로 남습니다."
      />

      <FilterBar>
        <Input
          className="sm:max-w-xs"
          placeholder="PL번호, 이름, 파일명, 컬러 검색..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="text-sm text-muted-foreground sm:ml-auto">
          {formatNumber(visibleWorkOrders.length)}건
        </div>
      </FilterBar>

      <div
        role="tablist"
        aria-label="작업 지시서 상태"
        className="china-work-tabs"
      >
        {WORK_ORDER_TABS.map((item) => {
          const selected = item.value === listTab
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setListTab(item.value)}
              className="china-work-tab"
            >
              <span>{item.label}</span>
              {tabCounts[item.value] > 0 ? (
                <span className="china-work-tab-badge">
                  {formatNumber(tabCounts[item.value])}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {draftsQuery.isError ? (
        <p className="mb-3 text-sm text-danger">
          작업 지시서를 불러오지 못했습니다.
        </p>
      ) : null}
      {shipMutation.isError ? (
        <p className="mb-3 text-sm text-danger">
          발송 완료를 저장하지 못했습니다.
        </p>
      ) : null}
      {assignMutation.isError ? (
        <p className="mb-3 text-sm text-danger">
          담당자를 저장하지 못했습니다.
        </p>
      ) : null}
      {departmentsQuery.isError || membersQuery.isError ? (
        <p className="mb-3 text-sm text-danger">
          중국팀 직원 목록을 불러오지 못했습니다.
        </p>
      ) : null}

      {draftsQuery.isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          불러오는 중...
        </p>
      ) : workOrders.length === 0 && listTab !== 'price' ? (
        <Card className="px-4 py-10 text-center text-sm text-muted-foreground">
          {search.trim()
            ? '조건에 맞는 작업 지시서가 없습니다.'
            : '기획안에서 샘플·컬러 작업 지시서를 올리고 저장하면 여기에 나타납니다.'}
        </Card>
      ) : visibleWorkOrders.length === 0 ? (
        <Card className="px-4 py-10 text-center text-sm text-muted-foreground">
          {listTab === 'price'
            ? '단가 요청이 없습니다.'
            : listTab === 'color'
              ? '컬러 샘플 요청이 없습니다.'
              : listTab === 'open'
                ? '진행 중인 작업 지시서가 없습니다.'
                : '종료된 작업 지시서가 없습니다.'}
        </Card>
      ) : (
        <div className="china-work-board" role="region" aria-label="중국팀 작업 지시서 목록" tabIndex={0}>
          <table className="china-work-table">
            <colgroup>
              <col />
              <col />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">BRAND</th>
                <th scope="col">IMAGE</th>
                <th scope="col">WORK ORDER</th>
              </tr>
            </thead>
            <tbody>
              {visibleWorkOrders.map((row) => {
                const { draft } = row
                const done = isWorkOrderDone(row)
                const note = done ? row.failReason : row.focusReason
                const shippingThis =
                  shipMutation.isPending &&
                  shipMutation.variables?.kind === row.kind &&
                  shipMutation.variables?.orderId === row.orderId
                const progress = draftStatePercent(draft)
                const brandName = draft.brandId
                  ? brandById.get(draft.brandId)?.name ?? '브랜드 미정'
                  : '브랜드 미정'
                const elapsed = sampleElapsedDaysLabel(row.shippedAt)
                const photoName = draft.nameEn.trim() || draft.nameKo.trim() || draft.draftNo
                return (
                  <tr key={`${draft.id}:${row.kind}:${row.orderId}`}>
                    <td>
                      <strong className="draft-sheet-brand">{brandName}</strong>
                      <div className="draft-sheet-owner">
                        Designer <strong>{draft.owner.trim() || '미정'}</strong>
                      </div>
                      <strong className="draft-sheet-number">No. {draft.draftNo}</strong>
                      <div className="draft-sheet-state">
                        <span>
                          State <strong>{progress}%</strong>
                        </span>
                        <span
                          className="draft-sheet-progress"
                          role="meter"
                          aria-label="기획 진행률"
                          aria-valuenow={progress}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <i style={{ width: `${progress}%` }} />
                        </span>
                      </div>
                      <div className="draft-sheet-samples" aria-label="샘플 진행">
                        <div className="draft-sheet-sample">
                          <span>
                            <b>{row.kind === 'color' ? '컬러 샘플' : 'Sample'}</b>
                            <small>{row.sortRound}차</small>
                          </span>
                          <div>
                            <span className="draft-sheet-sent" title="샘플 발송일">
                              <ArrowUpRight size={19} />
                              {sheetDay(row.shippedAt)}
                            </span>
                          </div>
                          {elapsed ? <p className="draft-sheet-elapsed">{elapsed}</p> : null}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="china-work-image">
                        <DraftPhoto src={draft.imageUrl} name={photoName} />
                        <div className="china-work-name">
                          <span>가명 (한글)</span>
                          <strong>{draft.nameKo.trim() || '—'}</strong>
                        </div>
                        <div className="china-work-name">
                          <span>Product Name</span>
                          <strong>{draft.nameEn.trim() || '—'}</strong>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="china-work-side">
                        {row.kind === 'sample' ? (
                          <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            담당자
                            <Select
                              className="h-8 min-w-40"
                              aria-label={`${draft.draftNo} 중국팀 담당자`}
                              value={row.assigneeId ?? ''}
                              disabled={
                                departmentsQuery.isLoading ||
                                membersQuery.isLoading ||
                                (assignMutation.isPending &&
                                  assignMutation.variables?.orderId === row.orderId)
                              }
                              onChange={(event) => {
                                const assigneeId = event.target.value
                                const member = chinaStaff.find((item) => item.id === assigneeId)
                                assignMutation.mutate({
                                  draft,
                                  orderId: row.orderId,
                                  assigneeId: assigneeId || null,
                                  assigneeName: member?.displayName?.trim() ?? row.assigneeName,
                                })
                              }}
                            >
                              <option value="">담당자 선택</option>
                              {row.assigneeId &&
                              !chinaStaff.some((member) => member.id === row.assigneeId) ? (
                                <option value={row.assigneeId}>
                                  {row.assigneeName || '지정된 담당자'}
                                </option>
                              ) : null}
                              {chinaStaff.map((member) => (
                                <option key={member.id} value={member.id}>
                                  {member.displayName?.trim() || '이름 없음'}
                                </option>
                              ))}
                            </Select>
                            {chinaStaff.length === 0 &&
                            !departmentsQuery.isLoading &&
                            !membersQuery.isLoading ? (
                              <span>중국팀에 등록된 직원이 없습니다.</span>
                            ) : null}
                          </label>
                        ) : null}
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <FileText className="size-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            {row.url ? (
                              <a
                                href={row.url}
                                download={row.fileName}
                                className="block truncate text-sm underline-offset-2 hover:underline"
                                onClick={(event) => {
                                  event.preventDefault()
                                  downloadWorkOrder(row)
                                }}
                              >
                                {row.fileName}
                              </a>
                            ) : (
                              <span className="block truncate text-sm">작업 지시서</span>
                            )}
                            <div className="text-[11px] text-muted-foreground">
                              {formatSavedAt(row.shippedAt || draft.updatedAt)}{' '}
                              {row.passed
                                ? '합격'
                                : row.failReason
                                  ? '불합격'
                                  : done
                                    ? '발송'
                                    : '저장'}
                              {row.fileCheckedAt ? ' · 확인' : ''}
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!row.url}
                            onClick={() => downloadWorkOrder(row)}
                          >
                            <Download className="size-3.5" />
                            받기
                          </Button>
                          <Button
                            type="button"
                            variant={done ? 'secondary' : 'outline'}
                            size="sm"
                            aria-pressed={done}
                            disabled={!row.url || done || shippingThis}
                            className={cn(
                              done &&
                                'border-success/40 bg-success/10 text-foreground hover:bg-success/15',
                            )}
                            onClick={() =>
                              shipMutation.mutate({
                                draft,
                                kind: row.kind,
                                orderId: row.orderId,
                              })
                            }
                          >
                            {done ? <Check className="size-3.5" /> : null}
                            {shippingThis ? '저장 중...' : '발송 완료'}
                          </Button>
                        </div>
                        {note ? (
                          <p className="rounded-md bg-muted/70 px-2.5 py-2 text-xs whitespace-pre-wrap">
                            {done ? '불합격 사유' : '중점'}: {note}
                          </p>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
