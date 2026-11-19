import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { useBasicWorkAccess } from '@/lib/supabase/basic-work-access'
import { diagnosticOperation } from '@/lib/diagnostics/workflow-trace'
import { getActiveWarehouseInventorySet, listWarehouseOutboundBoxQuantities } from '@/lib/supabase/warehouse-stock'
import { listAllStyleRefs } from '@/lib/supabase/styles'
import { warehouseProductNameKey } from '@/lib/warehouse/fixed-location-styles'
import { emptyList } from '@/lib/utils'
import type { StyleRef } from '@/lib/types'
import {
  readWarehouseOrganizationOutbound,
  saveWarehouseOrganizationOutbound,
  type WarehouseOrganizationOutboundItem,
} from '@/lib/supabase/warehouse-organization-outbound'
import {
  isWarehouseOutboundMonth,
  parseWarehouseOrganizationOutbound,
  warehouseOutboundMonthDays,
  warehouseOutboundDailyBoxes,
  warehouseOutboundBoxQuantities,
  warehouseOutboundPickingBoxes,
  warehouseOutboundStyleNumbers,
} from './warehouse-organization-outbound'

const PAGE_SIZE = 25
const numberFormat = new Intl.NumberFormat('ko-KR')
const dailyNumberFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 })
const BOX_ESTIMATE_PERIODS = [
  { days: 7, label: '1주일 예상 박스 수', key: 'week1' },
  { days: 14, label: '2주일 예상 박스 수', key: 'week2' },
  { days: 28, label: '4주 예상 박스 수', key: 'week4' },
] as const
const OUTBOUND_COLUMNS = [
  { key: 'row', label: '행', width: 'w-16' },
  { key: 'styleNo', label: 'M번호', width: 'w-28' },
  { key: 'productName', label: '상품명', width: '' },
  { key: 'pickingBoxes', label: '출고창고 박스 수', width: 'w-40' },
  { key: 'quantity', label: '출고 수량', width: 'w-28' },
  { key: 'dailyQuantity', label: '하루 출고량', width: 'w-32' },
  { key: 'dailyBoxes', label: '하루 출고 박스 수', width: 'w-40' },
  ...BOX_ESTIMATE_PERIODS.map(period => ({ ...period, width: 'w-40' })),
] as const
type OutboundSortKey = typeof OUTBOUND_COLUMNS[number]['key']
const productNameOrder = new Intl.Collator('ko-KR', { numeric: true })
const savedAtFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short',
})

function OutboundRows({ items, title, month, boxQuantities, pickingBoxes, stockLoading, stockError, styleNumbers, stylesLoading, stylesError }: {
  items: WarehouseOrganizationOutboundItem[]; title: string; month: string
  boxQuantities: ReadonlyMap<string, number>; stockLoading: boolean; stockError: boolean
  pickingBoxes: ReadonlyMap<string, { locationCode: string; boxes: number | null }[]>
  styleNumbers: ReadonlyMap<string, string | null>; stylesLoading: boolean; stylesError: boolean
}) {
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<{ key: OutboundSortKey; direction: 'asc' | 'desc' }>({ key: 'row', direction: 'asc' })
  const pages = Math.ceil(items.length / PAGE_SIZE)
  const currentPage = Math.min(page, pages - 1)
  const start = currentPage * PAGE_SIZE
  const total = items.reduce((sum, item) => sum + item.quantity, 0)
  const monthDays = warehouseOutboundMonthDays(month)
  const sortedRows = useMemo(() => items.map((item, index) => {
    const unitsPerBox = boxQuantities.get(warehouseProductNameKey(item.productName))
    const styleNo = !stylesLoading && !stylesError ? styleNumbers.get(warehouseProductNameKey(item.productName)) : undefined
    const pickingLocations = pickingBoxes.get(warehouseProductNameKey(item.productName)) ?? []
    const pickingBoxCount = stockLoading || stockError || pickingLocations.some(location => location.boxes == null)
      ? null : pickingLocations.reduce((sum, location) => sum + (location.boxes ?? 0), 0)
    const dailyQuantity = monthDays ? item.quantity / monthDays : null
    const dailyBoxes = !stockLoading && !stockError ? warehouseOutboundDailyBoxes(item.quantity, monthDays, unitsPerBox) : null
    return {
      item, index, unitsPerBox, dailyQuantity, dailyBoxes, styleNo, pickingBoxCount,
      values: {
        row: index + 1, styleNo, productName: item.productName, pickingBoxes: pickingBoxCount, quantity: item.quantity, dailyQuantity, dailyBoxes,
        week1: dailyBoxes == null ? null : dailyBoxes * 7,
        week2: dailyBoxes == null ? null : dailyBoxes * 14,
        week4: dailyBoxes == null ? null : dailyBoxes * 28,
      },
    }
  }).sort((left, right) => {
    const a = left.values[sort.key]
    const b = right.values[sort.key]
    if (a == null) return b == null ? left.index - right.index : 1
    if (b == null) return -1
    const compared = typeof a === 'string' && typeof b === 'string'
      ? productNameOrder.compare(a, b)
      : Number(a) - Number(b)
    return compared * (sort.direction === 'asc' ? 1 : -1) || left.index - right.index
  }), [items, boxQuantities, pickingBoxes, monthDays, stockLoading, stockError, sort, styleNumbers, stylesLoading, stylesError])

  function changeSort(key: OutboundSortKey) {
    setSort(current => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }))
    setPage(0)
  }

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-sm tabular-nums text-muted-foreground">
          {numberFormat.format(items.length)}행 · 총 {numberFormat.format(total)}개
        </p>
      </div>
      {monthDays && <p className="text-xs text-muted-foreground">하루 출고량은 {month} 출고 수량 ÷ {monthDays}일입니다. 주별 예상 박스 수는 하루 박스 수에 7일·14일·28일을 곱하며, 소수점 둘째 자리까지 표시합니다.</p>}
      <div className="overflow-auto rounded-lg border border-border">
        <table aria-label={title} className="w-full min-w-[1400px] table-fixed text-sm">
          <thead className="bg-primary text-primary-foreground">
            <tr>
              {OUTBOUND_COLUMNS.map(column => {
                const selected = sort.key === column.key
                const Icon = selected ? sort.direction === 'asc' ? ArrowUp : ArrowDown : ArrowUpDown
                const nextDirection = selected && sort.direction === 'asc' ? '내림차순' : '오름차순'
                return <th key={column.key} scope="col" aria-sort={selected ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'} className={`${column.width} p-0`}>
                  <button type="button" onClick={() => changeSort(column.key)} aria-label={`${column.label} ${nextDirection} 정렬`} className={`flex w-full items-center gap-1 px-3 py-2 text-inherit hover:bg-primary-foreground/10 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 ${column.key === 'productName' ? 'justify-start' : 'justify-end'}`}>
                    {column.label}<Icon className="size-3 shrink-0" aria-hidden="true" />
                  </button>
                </th>
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.slice(start, start + PAGE_SIZE).map(({ item, index, unitsPerBox, dailyBoxes, styleNo, pickingBoxCount }) => {
              return (
                <tr key={index} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{index + 1}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {stylesError ? '조회 실패' : stylesLoading ? '조회 중…' : styleNo ?? <span className="text-muted-foreground">{styleNumbers.has(warehouseProductNameKey(item.productName)) ? '확인 필요' : '—'}</span>}
                  </td>
                  <td className="break-words px-3 py-1.5">{item.productName}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {stockError ? '조회 실패' : stockLoading ? '조회 중…' : pickingBoxCount == null
                      ? <span className="text-muted-foreground">수량 확인 필요</span> : `${numberFormat.format(pickingBoxCount)}박스`}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{numberFormat.format(item.quantity)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{monthDays ? dailyNumberFormat.format(item.quantity / monthDays) : '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {stockError ? '조회 실패' : stockLoading ? '조회 중…' : dailyBoxes != null && unitsPerBox
                      ? <>{dailyNumberFormat.format(dailyBoxes)}박스<small className="block text-xs text-muted-foreground">박스당 {numberFormat.format(unitsPerBox)}개</small></>
                      : <span className="text-muted-foreground">박스당 수량 없음</span>}
                  </td>
                  {BOX_ESTIMATE_PERIODS.map(period => <td key={period.days} className="px-3 py-1.5 text-right tabular-nums">
                    {stockError ? '조회 실패' : stockLoading ? '조회 중…' : dailyBoxes != null
                      ? `${dailyNumberFormat.format(dailyBoxes * period.days)}박스`
                      : <span className="text-muted-foreground">박스당 수량 없음</span>}
                  </td>)}
                </tr>
              )
            })}
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

type OutboundMonthProps = { brandId: string; month: string; onMonthChange: (month: string) => void }

export function WarehouseOrganizationOutboundPanel({ brandId, month, onMonthChange }: OutboundMonthProps) {
  const { access, isPending, isError } = useBasicWorkAccess()
  if (isPending) return <p className="text-sm text-muted-foreground">창고 정리 권한 확인 중…</p>
  if (isError) return <p role="alert" className="text-sm text-danger">창고 정리 권한을 확인하지 못했습니다.</p>
  if (!access?.brandDomains?.[brandId]?.includes('logistics')) {
    return <p className="text-sm text-muted-foreground">이 브랜드의 물류 업무 권한이 필요합니다.</p>
  }
  return <OutboundMonthForm key={`${brandId}:${access.profileId}:${month}`} brandId={brandId} viewerId={access.profileId} month={month} onMonthChange={onMonthChange} />
}

function OutboundMonthForm({ brandId, viewerId, month, onMonthChange }: OutboundMonthProps & { viewerId: string }) {
  useRenderWatch('WarehouseOrganizationOutboundPanel')
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
  const hasItems = Boolean(draftItems?.length || record?.items.length)
  const styles = useQuery({
    queryKey: ['styles', brandId, 'warehouse-organization-refs', viewerId],
    queryFn: () => diagnosticOperation('app', 'warehouse_organization_styles', trace =>
      trace.run('read_catalog', context => listAllStyleRefs(brandId, context))),
    enabled: tabActive && hasItems,
  })
  const catalog = styles.data ?? emptyList<StyleRef>()
  const styleNumbers = useMemo(() => warehouseOutboundStyleNumbers(catalog), [catalog])
  const inventory = useQuery({
    queryKey: ['warehouse-inventory-set', brandId],
    queryFn: () => diagnosticOperation('app', 'warehouse_organization_boxes', trace =>
      trace.run('active_inventory', context => getActiveWarehouseInventorySet(brandId, context))),
    enabled: tabActive && hasItems,
  })
  const setId = inventory.data?.id
  const positions = useQuery({
    queryKey: ['warehouse-stock-positions', brandId, setId, 'outbound-boxes-fifo', viewerId],
    queryFn: ({ signal }) => listWarehouseOutboundBoxQuantities(brandId, setId!, signal),
    enabled: tabActive && hasItems && Boolean(setId),
  })
  const stockRows = positions.data
  const boxQuantities = useMemo(() => warehouseOutboundBoxQuantities(stockRows ?? []), [stockRows])
  const pickingBoxes = useMemo(() => warehouseOutboundPickingBoxes(stockRows ?? []), [stockRows])
  const stockLoading = inventory.isLoading || Boolean(setId && positions.isPending)
  const stockError = inventory.isError || Boolean(setId && positions.isError)
  const boxProps = { boxQuantities, pickingBoxes, stockLoading, stockError, styleNumbers, stylesLoading: styles.isPending, stylesError: styles.isError }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="grid gap-1.5 text-sm font-medium">
          출고 기준 월
          <Input type="month" value={month} disabled={save.isPending}
            onChange={event => {
              onMonthChange(event.target.value)
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
      {hasItems && <p className="text-xs text-muted-foreground">출고창고 박스 수는 선입선출 위치1부터 출고창고가 연속되는 구간만 합산하며, 박스창고가 나오면 멈춥니다. 헤더 정렬도 이 합계 기준입니다. 하루 출고 박스 수는 현재 박스창고·출고창고의 동일 상품 중 가장 큰 박스당 수량을 기준으로 환산합니다.</p>}
      {hasItems && <p className="text-xs text-muted-foreground">M번호는 전체 상품에서 상품명이 일치하는 SKU를 조회합니다. 동일 이름의 SKU가 여러 개이거나 M번호가 비어 있으면 확인 필요로 표시합니다.</p>}
      {styles.isError && <p role="alert" className="text-sm text-danger">M번호를 조회하지 못했습니다. <Button type="button" size="sm" variant="outline" onClick={() => { void styles.refetch() }}>M번호 다시 불러오기</Button></p>}
      {stockError && <p role="alert" className="text-sm text-danger">박스당 수량을 조회하지 못했습니다. <Button type="button" size="sm" variant="outline" onClick={() => { void inventory.refetch(); if (setId) void positions.refetch() }}>재고 다시 불러오기</Button></p>}
      {draftItems ? <OutboundRows key="preview" items={draftItems} title="저장할 출고 데이터" month={month} {...boxProps} />
        : record ? <OutboundRows key={`${month}:${record.revision}`} items={record.items} title="저장된 출고 데이터" month={month} {...boxProps} />
          : record === null ? <p className="text-sm text-muted-foreground">이 달에 저장한 출고 데이터가 없습니다.</p> : null}
    </div>
  )
}
