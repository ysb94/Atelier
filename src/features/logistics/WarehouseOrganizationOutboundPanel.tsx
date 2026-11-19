import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { useBasicWorkAccess } from '@/lib/supabase/basic-work-access'
import {
  readWarehouseOrganizationOutbound,
  saveWarehouseOrganizationOutbound,
  type WarehouseOrganizationOutboundItem,
} from '@/lib/supabase/warehouse-organization-outbound'
import {
  isWarehouseOutboundMonth,
  parseWarehouseOrganizationOutbound,
  previousWarehouseOutboundMonth,
  warehouseOutboundMonthDays,
} from './warehouse-organization-outbound'

const PAGE_SIZE = 25
const numberFormat = new Intl.NumberFormat('ko-KR')
const dailyNumberFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 })
const savedAtFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short',
})

function OutboundRows({ items, title, month }: { items: WarehouseOrganizationOutboundItem[]; title: string; month: string }) {
  const [page, setPage] = useState(0)
  const pages = Math.ceil(items.length / PAGE_SIZE)
  const currentPage = Math.min(page, pages - 1)
  const start = currentPage * PAGE_SIZE
  const total = items.reduce((sum, item) => sum + item.quantity, 0)
  const monthDays = warehouseOutboundMonthDays(month)

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-sm tabular-nums text-muted-foreground">
          {numberFormat.format(items.length)}행 · 총 {numberFormat.format(total)}개
        </p>
      </div>
      {monthDays && <p className="text-xs text-muted-foreground">하루 출고량은 {month} 출고 수량 ÷ {monthDays}일이며, 소수점 둘째 자리까지 표시합니다.</p>}
      <div className="overflow-auto rounded-lg border border-border">
        <table aria-label={title} className="w-full table-fixed text-sm">
          <thead className="bg-primary text-primary-foreground">
            <tr>
              <th scope="col" className="w-16 px-3 py-2 text-right">행</th>
              <th scope="col" className="px-3 py-2 text-left">상품명</th>
              <th scope="col" className="w-28 px-3 py-2 text-right">출고 수량</th>
              <th scope="col" className="w-32 px-3 py-2 text-right">하루 출고량</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(start, start + PAGE_SIZE).map((item, index) => (
              <tr key={start + index} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{start + index + 1}</td>
                <td className="break-words px-3 py-1.5">{item.productName}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{numberFormat.format(item.quantity)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{monthDays ? dailyNumberFormat.format(item.quantity / monthDays) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button type="button" size="sm" variant="outline" disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}>이전</Button>
          <span className="text-xs tabular-nums text-muted-foreground">{currentPage + 1} / {pages}</span>
          <Button type="button" size="sm" variant="outline" disabled={currentPage + 1 === pages}
            onClick={() => setPage(currentPage + 1)}>다음</Button>
        </div>
      )}
    </section>
  )
}

export function WarehouseOrganizationOutboundPanel({ brandId }: { brandId: string }) {
  const { access, isPending, isError } = useBasicWorkAccess()
  if (isPending) return <p className="text-sm text-muted-foreground">창고 정리 권한 확인 중…</p>
  if (isError) return <p role="alert" className="text-sm text-danger">창고 정리 권한을 확인하지 못했습니다.</p>
  if (!access?.brandDomains?.[brandId]?.includes('logistics')) {
    return <p className="text-sm text-muted-foreground">이 브랜드의 물류 업무 권한이 필요합니다.</p>
  }
  return <OutboundMonthForm key={`${brandId}:${access.profileId}`} brandId={brandId} viewerId={access.profileId} />
}

function OutboundMonthForm({ brandId, viewerId }: { brandId: string; viewerId: string }) {
  useRenderWatch('WarehouseOrganizationOutboundPanel')
  const [month, setMonth] = useState(previousWarehouseOutboundMonth)
  const [input, setInput] = useState('')
  const [preview, setPreview] = useState<ReturnType<typeof parseWarehouseOrganizationOutbound>>()
  const [notice, setNotice] = useState('')
  const tabActive = useWorkspaceTabActivity()
  const client = useQueryClient()
  const validMonth = isWarehouseOutboundMonth(month)
  const queryKey = ['warehouse-organization-outbound', brandId, viewerId, month] as const
  const stored = useQuery({
    queryKey,
    queryFn: ({ signal }) => readWarehouseOrganizationOutbound(brandId, month, signal),
    enabled: validMonth && tabActive,
    retry: false,
  })
  const record = stored.data?.ready ? stored.data.record : undefined
  const save = useMutation({
    mutationFn: ({ items, revision }: { items: WarehouseOrganizationOutboundItem[]; revision: number }) =>
      saveWarehouseOrganizationOutbound(brandId, month, items, revision),
    onSuccess: saved => {
      client.setQueryData(queryKey, { ready: true, record: saved })
      setInput('')
      setPreview(undefined)
      setNotice(`${month} 출고 데이터를 저장했습니다.`)
    },
  })
  const draftItems = preview && 'items' in preview ? preview.items : undefined

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="grid gap-1.5 text-sm font-medium">
          출고 기준 월
          <Input type="month" value={month} disabled={save.isPending}
            onChange={event => {
              setMonth(event.target.value)
              setNotice('')
              save.reset()
            }} />
        </label>
        {record && <p className="text-xs text-muted-foreground">최근 저장 {savedAtFormat.format(new Date(record.updated_at))}</p>}
      </div>
      <label className="grid gap-1.5 text-sm font-medium">
        상품별 출고 데이터 붙여넣기
        <Textarea value={input} rows={5} disabled={save.isPending} aria-describedby="warehouse-outbound-paste-help"
          onChange={event => {
            setInput(event.target.value)
            setPreview(undefined)
            setNotice('')
            save.reset()
          }} />
      </label>
      <p id="warehouse-outbound-paste-help" className="text-xs text-muted-foreground">
        엑셀에서 상품명과 출고 수량 두 열을 복사해 붙여넣으세요. 수량 0도 함께 저장됩니다.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={!input.trim() || save.isPending}
          onClick={() => setPreview(parseWarehouseOrganizationOutbound(input))}>미리 보기</Button>
        <Button type="button" disabled={!draftItems || record === undefined || stored.isFetching || save.isPending}
          onClick={() => {
            if (draftItems && record !== undefined) save.mutate({ items: draftItems, revision: record?.revision ?? 0 })
          }}>
          {save.isPending ? '저장 중…' : record ? '이 달 자료 교체' : '저장'}
        </Button>
      </div>
      {!validMonth && <p role="alert" className="text-sm text-danger">출고 기준 월을 선택해 주세요.</p>}
      {validMonth && stored.isLoading && <p role="status" className="text-sm text-muted-foreground">저장 자료 조회 중…</p>}
      {validMonth && stored.data?.ready === false && (
        <p role="status" className="text-sm text-muted-foreground">공용 저장 설정이 적용되면 출고 데이터를 저장할 수 있습니다.</p>
      )}
      {(stored.isError || save.isError) && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
          {save.error?.message ?? '저장 자료를 불러오지 못했습니다.'}
          <Button type="button" size="sm" variant="outline" disabled={stored.isFetching}
            onClick={async () => {
              const latest = await stored.refetch()
              if (latest.isSuccess) save.reset()
            }}>저장 자료 다시 불러오기</Button>
        </div>
      )}
      {notice && <p role="status" className="text-sm text-success">{notice}</p>}
      {preview && 'error' in preview && <p role="alert" className="text-sm text-danger">{preview.error}</p>}
      {draftItems ? <OutboundRows key="preview" items={draftItems} title="저장할 출고 데이터" month={month} />
        : record ? <OutboundRows key={`${month}:${record.revision}`} items={record.items} title="저장된 출고 데이터" month={month} />
          : record === null ? <p className="text-sm text-muted-foreground">이 달에 저장한 출고 데이터가 없습니다.</p> : null}
    </div>
  )
}
