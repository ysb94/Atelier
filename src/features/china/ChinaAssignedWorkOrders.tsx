import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Download, FileText, Send } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { DraftPhoto } from '@/features/drafts/DraftSheetRow'
import { startWorkflow } from '@/lib/diagnostics/workflow-trace'
import { colorSampleLabel, sampleOrderLabel } from '@/lib/drafts/sample-registration'
import { sampleElapsedDays, sampleTripSpanDays } from '@/lib/drafts/sample-work-order'
import { cn, formatNumber } from '@/lib/utils'
import { checkMyChinaWorkOrder, getMyChinaWorkOrderFile, shipMyChinaWorkOrder, type AssignedChinaOrder } from '@/lib/supabase/china-assigned-work-orders'
import { ChinaMaterialRequests } from './ChinaMaterialRequests'
import { useMaterialRequests } from '@/features/planning/useMaterialRequests'
import { workerMaterialGroups } from './china-material-workload'

const workTabs = [
  { value: 'orders', label: '작업 지시서' },
  { value: 'materials', label: '자재요청' },
  { value: 'purchase', label: '발주서' },
  { value: 'outbound', label: '출고작업' },
] as const
const dateFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function orderStatus(order: AssignedChinaOrder) {
  const timestamp = order.receivedAt ?? order.returnedAt
  if (!timestamp) return order.closed ? '처리 완료' : '발송 대기'
  const date = new Date(timestamp)
  const label = order.receivedAt ? '본사 수령 완료' : '발송 · 본사로 이동 중'
  return Number.isNaN(date.getTime()) ? label : `${dateFormat.format(date)} ${label}`
}

export function ChinaAssignedWorkOrders({ orders, brandById, accountId }: {
  orders: readonly AssignedChinaOrder[]
  brandById: ReadonlyMap<string, { name: string }>
  accountId: string
}) {
  const cache = useQueryClient()
  const [tab, setTab] = useState<(typeof workTabs)[number]['value']>('orders')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const materials = useMaterialRequests('china', { refreshMs: 30_000 })
  const materialGroups = workerMaterialGroups(materials.requests, accountId)
  const materialOpen = materialGroups.filter(({ rounds }) => rounds.some(round => !round.shippedAt)).length
  const materialUnread = materialGroups.filter(({ rounds }) => rounds.some(round => !round.shippedAt && !round.assigneeRead)).length
  const groups = new Map<string, AssignedChinaOrder[]>()
  for (const order of orders) {
    const group = groups.get(order.draftId)
    if (group) group.push(order)
    else groups.set(order.draftId, [order])
  }
  const activeCount = [...groups.values()].filter(rows => rows.some(order => !order.closed)).length
  const uncheckedPlans = new Set(orders.filter(order => !order.closed && !order.assigneeCheckedAt).map(order => order.draftId)).size

  async function handleOrder(order: AssignedChinaOrder, action: 'download' | 'ship') {
    if (busy || (action === 'ship' && order.closed)) return
    const trace = startWorkflow('app', action === 'ship' ? 'china_work_ship' : 'china_assigned_work_file')
    trace.step('validate_input')
    setBusy(true)
    setError('')
    try {
      if (action === 'download') {
        const url = await trace.run('get_file', () => getMyChinaWorkOrderFile(order))
        const link = document.createElement('a')
        link.href = url
        if (!['https:', 'http:', 'data:'].includes(link.protocol)) throw new Error('지원하지 않는 파일 주소입니다.')
        link.download = order.fileName?.trim() || '작업 지시서'
        link.rel = 'noopener'
        document.body.appendChild(link)
        link.click()
        link.remove()
        if (!order.assigneeCheckedAt) {
          await trace.run('save', context => checkMyChinaWorkOrder(order, context), { writeOutcome: 'committed' })
          await trace.run('refresh', () => Promise.all([
            cache.invalidateQueries({ queryKey: ['china-work-screen', accountId] }),
            cache.invalidateQueries({ queryKey: ['product-drafts'] }),
          ]), { writeOutcome: 'committed' })
        }
        trace.done({ writeOutcome: order.assigneeCheckedAt ? 'none' : 'committed' })
      } else {
        await trace.run('save', context => shipMyChinaWorkOrder(order, context))
        await trace.run('refresh', () => Promise.all([
          cache.invalidateQueries({ queryKey: ['china-work-screen', accountId] }),
          cache.invalidateQueries({ queryKey: ['product-drafts'] }),
        ]), { writeOutcome: 'committed' })
        trace.done({ writeOutcome: 'committed' })
      }
    } catch (cause) {
      trace.fail(cause)
      setError(cause instanceof Error ? cause.message : '작업을 처리하지 못했습니다.')
      void cache.invalidateQueries({ queryKey: ['china-work-screen', accountId] })
    } finally {
      setBusy(false)
    }
  }

  return <div>
    <PageHeader title="중국 업무" description="같은 상품의 샘플 회차를 한 묶음으로 표시합니다. 발송하면 기획안 회차에 발송일이 남습니다." />
    <div className="mb-5 flex flex-wrap items-center gap-4">
      <FilterTabs tabs={workTabs.map(item => {
        if (item.value === 'orders') return { ...item, ...(uncheckedPlans > 0 ? { aboveCount: uncheckedPlans } : {}), workload: { open: activeCount, resting: groups.size - activeCount } }
        if (item.value === 'materials' && materials.query.isSuccess) return {
          ...item, ...(materialUnread > 0 ? { aboveCount: materialUnread } : {}),
          workload: { open: materialOpen, resting: materialGroups.length - materialOpen, title: '발송 전 자재요청 / 발송 후 완료 대기 자재요청' },
        }
        return item
      })} value={tab} onChange={setTab} ariaLabel="중국팀 업무" variant="underline" size="large" className="flex-1" />
      {tab !== 'materials' && <Badge variant="muted">화면 구성 미리보기</Badge>}
    </div>
    {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
    {tab === 'orders' ? <Card className="overflow-x-auto">
      <table className="w-full min-w-[820px] table-fixed border-collapse text-sm">
        <colgroup><col className="w-[30%]" /><col className="w-[22%]" /><col className="w-[48%]" /></colgroup>
        <thead className="bg-primary text-primary-foreground">
          <tr>{['상품', '샘플차수', '파일'].map(label => <th key={label} scope="col" className="px-4 py-5 text-center font-medium">{label}</th>)}</tr>
        </thead>
        {orders.length === 0 && <tbody><tr><td colSpan={3} className="p-10 text-center text-muted-foreground">배정된 작업 지시서가 없습니다.</td></tr></tbody>}
        {[...groups.values()].map(rows => {
          const samples = rows.filter(order => order.kind === 'sample').map(order => ({ id: order.orderId, round: order.round, sampleStage: order.sampleStage }))
          const draft = rows[0]
          return <tbody key={draft.draftId} className="border-b border-border last:border-b-0">
            {rows.map((order, index) => {
              const days = order.closed
                ? sampleTripSpanDays(order.shippedAt ?? null, order.returnedAt || order.receivedAt)
                : sampleElapsedDays(order.shippedAt ?? null)
              return <tr key={`${order.kind}:${order.orderId}`} className="border-t border-border first:border-t-0">
              {index === 0 && <td rowSpan={rows.length} className="border-r border-border p-4 align-middle">
                <div className="flex items-center gap-3 [&>.draft-sheet-photo]:aspect-square [&>.draft-sheet-photo]:w-[44%] [&>.draft-sheet-photo]:shrink-0">
                  <DraftPhoto src={draft.imageUrl} name={draft.nameKo || draft.nameEn || draft.draftNo} />
                  <div className="min-w-0 space-y-1 break-words">
                    <p className="font-semibold">{draft.brandId ? brandById.get(draft.brandId)?.name ?? '브랜드 미정' : '브랜드 미정'}</p>
                    <p className="text-xs text-muted-foreground">Designer {draft.owner || '미정'}</p>
                    <p className="font-semibold">No. {draft.draftNo}</p>
                    <p className="text-primary">{draft.nameKo}</p>
                    {draft.nameEn && <p className="text-primary">{draft.nameEn}</p>}
                  </div>
                </div>
              </td>}
              <td className="border-r border-border px-4 py-3 align-middle">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <strong className="font-medium">{order.kind === 'color' ? colorSampleLabel(order.round) : sampleOrderLabel({ id: order.orderId, round: order.round, sampleStage: order.sampleStage }, samples)}</strong>
                  <span className={cn('shrink-0 whitespace-nowrap font-semibold tabular-nums',
                    days == null ? 'text-xs text-muted-foreground' : order.closed ? 'text-base text-foreground' : 'text-base text-primary')}>
                    {days == null ? '기간 미등록' : `${order.closed ? '' : '+ '}${formatNumber(days)} days`}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="grid grid-cols-[auto_minmax(0,1fr)_4.75rem_7.25rem] items-center gap-3">
                  <FileText className="size-5 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="break-words">{order.fileName?.trim() || '작업 지시서'}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{orderStatus(order)}</p>
                  </div>
                  {order.assigneeCheckedAt
                    ? <Button type="button" variant="secondary" size="sm" className="w-full text-muted-foreground" disabled={busy} onClick={() => void handleOrder(order, 'download')}><Check className="size-3.5" aria-hidden="true" />받기</Button>
                    : <Button type="button" variant="outline" size="sm" className="w-full text-primary" disabled={busy} onClick={() => void handleOrder(order, 'download')}><Download className="size-3.5" aria-hidden="true" />받기</Button>}
                  {order.closed ? <Badge variant="muted" className="h-8 w-full justify-center"><Check className="mr-1 size-3.5" aria-hidden="true" />{order.returnedAt || order.receivedAt ? '발송 완료' : '완료'}</Badge>
                    : <Button type="button" variant="outline" size="sm" className="w-full text-primary" disabled={busy} onClick={() => void handleOrder(order, 'ship')}><Send className="size-3.5" aria-hidden="true" />발송 하기</Button>}
                </div>
              </td>
              </tr>
            })}
          </tbody>
        })}
      </table>
    </Card> : tab === 'materials' ? <ChinaMaterialRequests accountId={accountId} />
      : <Card className="p-12 text-center text-sm text-muted-foreground">{workTabs.find(item => item.value === tab)?.label} 업무 화면을 준비 중입니다.</Card>}
  </div>
}
