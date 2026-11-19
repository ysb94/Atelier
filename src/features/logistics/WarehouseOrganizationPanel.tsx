import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWorkspaceTabActivity, WorkspaceTabActivityContext } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FilterBar } from '@/components/ui/filter-bar'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { Input } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { emptyList } from '@/lib/utils'
import { useBasicWorkAccess } from '@/lib/supabase/basic-work-access'
import { getActiveWarehouseInventorySet, listWarehouseMissingStyleProducts } from '@/lib/supabase/warehouse-stock'
import type { MissingStyleWarehousePosition } from '@/lib/warehouse/missing-style-products'
import { formatWarehouseLocation, formatWarehouseReceivedOn, isWarehouseQuantityKnown, warehousePositionQty } from '@/lib/warehouse/stock'
import { WarehouseOrganizationOutboundPanel } from './WarehouseOrganizationOutboundPanel'

const PAGE_SIZE = 25
const NUMBER_FORMAT = new Intl.NumberFormat('ko-KR')
const LOCATION_ORDER = new Intl.Collator('ko-KR', { numeric: true })

export function WarehouseOrganizationPanel({ brandId, month, onMonthChange }: {
  brandId: string; month: string; onMonthChange: (month: string) => void
}) {
  const [tab, setTab] = useState<'outbound' | 'missing-style'>('outbound')
  const tabActive = useWorkspaceTabActivity()
  return <div className="space-y-3">
    <FilterTabs ariaLabel="창고 정리 작업" value={tab} onChange={setTab} tabs={[
      { value: 'outbound', label: '출고 데이터' }, { value: 'missing-style', label: 'M번호 없는 상품' },
    ]} />
    <WorkspaceTabActivityContext.Provider value={tabActive && tab === 'outbound'}>
      <div hidden={tab !== 'outbound'}>
        <WarehouseOrganizationOutboundPanel brandId={brandId} month={month} onMonthChange={onMonthChange} />
      </div>
    </WorkspaceTabActivityContext.Provider>
    {tab === 'missing-style' && <MissingStyleProductsPanel brandId={brandId} />}
  </div>
}

function MissingStyleProductsPanel({ brandId }: { brandId: string }) {
  const { access, isPending, isError } = useBasicWorkAccess()
  if (isPending) return <p role="status" className="text-sm text-muted-foreground">물류 권한 확인 중…</p>
  if (isError) return <p role="alert" className="text-sm text-danger">물류 권한을 확인하지 못했습니다.</p>
  if (!access?.brandDomains?.[brandId]?.includes('logistics')) return <p className="text-sm text-muted-foreground">이 브랜드의 물류 업무 권한이 필요합니다.</p>
  return <MissingStyleProducts key={`${brandId}:${access.profileId}`} brandId={brandId} viewerId={access.profileId} />
}

function MissingStyleProducts({ brandId, viewerId }: { brandId: string; viewerId: string }) {
  useRenderWatch('WarehouseMissingStyleProducts')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const tabActive = useWorkspaceTabActivity()
  const inventory = useQuery({
    queryKey: ['warehouse-inventory-set', brandId],
    queryFn: () => getActiveWarehouseInventorySet(brandId),
    enabled: tabActive,
  })
  const setId = inventory.data?.id
  const stock = useQuery({
    queryKey: ['warehouse-stock-positions', brandId, setId, 'without-style-number', viewerId],
    queryFn: ({ signal }) => listWarehouseMissingStyleProducts(brandId, setId!, signal),
    enabled: tabActive && Boolean(setId),
    retry: false,
  })
  const rows = stock.data ?? emptyList<MissingStyleWarehousePosition>()
  const filtered = useMemo(() => {
    const key = search.trim().normalize('NFKC').toLocaleLowerCase('ko-KR')
    return rows.filter(row => !key || `${row.styleName}\n${formatWarehouseLocation(row)}`.normalize('NFKC').toLocaleLowerCase('ko-KR').includes(key))
      .sort((left, right) => LOCATION_ORDER.compare(left.locationCode, right.locationCode) || LOCATION_ORDER.compare(left.styleName, right.styleName))
  }, [rows, search])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const unknown = filtered.filter(row => !isWarehouseQuantityKnown(row)).length
  const productCount = new Set(filtered.map(row => row.styleName.trim().normalize('NFC') || row.id)).size
  const loading = inventory.isPending || Boolean(setId && stock.isPending)
  const error = inventory.isError || Boolean(setId && stock.isError)
  const ready = Boolean(setId && stock.data !== undefined)
  const quantity = (value: number | null) => value == null ? '—' : NUMBER_FORMAT.format(value)

  return <section aria-label="박스창고 M번호 없는 상품" className="space-y-2">
    <p className="text-xs text-muted-foreground">현재 박스창고에서 M번호가 비어 있는 재고입니다. 같은 상품이 여러 위치에 있으면 위치별로 표시합니다.</p>
    <FilterBar className="mb-0 gap-2 p-2">
      <Input aria-label="M번호 없는 상품명·위치 검색" placeholder="상품명·현재 위치 검색" className="h-8 sm:max-w-xs"
        value={search} onChange={event => { setSearch(event.target.value); setPage(0) }} />
      <Button type="button" size="sm" variant="outline" className="h-8" disabled={inventory.isFetching || stock.isFetching}
        onClick={async () => {
          const latest = await inventory.refetch()
          if (latest.isSuccess && latest.data?.id && latest.data.id === setId) void stock.refetch()
        }}>다시 조회</Button>
      {ready && !error && <span role="status" className="text-xs tabular-nums text-muted-foreground">
        상품 {NUMBER_FORMAT.format(productCount)}종 · 위치 {NUMBER_FORMAT.format(filtered.length)}행{unknown > 0 && <span className="ml-2 text-warning">수량 미확인 {unknown}행</span>}
      </span>}
    </FilterBar>
    {error && <p role="alert" className="text-sm text-danger">박스창고 재고를 불러오지 못했습니다. 다시 조회해 주세요.</p>}
    {loading && <p role="status" className="text-sm text-muted-foreground">M번호 없는 상품 조회 중…</p>}
    {inventory.data === null && !error && <p role="status" className="text-sm text-muted-foreground">조회할 창고 재고가 없습니다.</p>}
    {ready && <Card className="overflow-hidden shadow-none">
      <div className="max-h-[480px] overflow-auto">
        <table aria-label="박스창고 M번호 없는 상품 목록" className="w-full min-w-[860px] table-fixed text-xs">
          <thead className="sticky top-0 bg-primary text-primary-foreground">
            <tr><th scope="col" className="px-2 py-2 text-left font-medium">상품명</th>
              <th scope="col" className="w-36 px-2 py-2 text-left font-medium">현재 위치</th>
              <th scope="col" className="w-24 px-2 py-2 text-right font-medium">잔여 박스 수</th>
              <th scope="col" className="w-24 px-2 py-2 text-right font-medium">박스당 수량</th>
              <th scope="col" className="w-28 px-2 py-2 text-right font-medium">개봉 낱개 수량</th>
              <th scope="col" className="w-28 px-2 py-2 text-right font-medium">총 수량</th>
              <th scope="col" className="w-28 px-2 py-2 text-left font-medium">입고일</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(row => <tr key={row.id}>
              <td className="break-words px-2 py-2">{row.styleName || '상품명 없음'}</td>
              <td className="break-words px-2 py-2">{formatWarehouseLocation(row)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{quantity(row.remainingBoxes)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{quantity(row.unitsPerBox)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{quantity(row.openedUnits)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{isWarehouseQuantityKnown(row) ? quantity(warehousePositionQty(row)) : <span className="text-warning">수량 미확인</span>}</td>
              <td className="px-2 py-2">{formatWarehouseReceivedOn(row) || '—'}</td>
            </tr>)}
            {filtered.length === 0 && <tr><td colSpan={7} className="px-2 py-5 text-center text-muted-foreground">
              {search.trim() ? '검색 결과가 없습니다.' : '박스창고에 M번호 없는 상품이 없습니다.'}
            </td></tr>}
          </tbody>
        </table>
      </div>
    </Card>}
    {ready && pageCount > 1 && <div className="flex items-center justify-end gap-2">
      <Button type="button" size="sm" variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>이전</Button>
      <span className="text-xs tabular-nums">{currentPage + 1} / {pageCount}</span>
      <Button type="button" size="sm" variant="outline" disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}>다음</Button>
    </div>}
  </section>
}
