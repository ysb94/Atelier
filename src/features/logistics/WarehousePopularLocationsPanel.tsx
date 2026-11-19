import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { combineListQueries } from '@/lib/query/list-queries'
import { popularProductAvailability, popularProductLocations, type PopularLocationProduct } from '@/lib/warehouse/popular-products'
import { warehouseProductNameKey } from '@/lib/warehouse/fixed-location-styles'
import { useBasicWorkAccess } from '@/lib/supabase/basic-work-access'
import {
  readWarehousePopularLocations,
  saveWarehousePopularLocations,
  WarehousePopularLocationsChangedError,
} from '@/lib/supabase/warehouse-popular-locations'
import { getActiveWarehouseInventorySet, listWarehouseLocationProducts, listWarehouseOutboundBoxQuantities, listWarehousePopularProductPositions } from '@/lib/supabase/warehouse-stock'
import { readWarehouseOrganizationOutbound } from '@/lib/supabase/warehouse-organization-outbound'
import { listAllStyleRefs } from '@/lib/supabase/styles'
import { isWarehouseOutboundMonth, warehouseOutboundBoxQuantities, warehouseOutboundStyleNumbers, warehousePopularOutboundProducts } from './warehouse-organization-outbound'

const LOCATION_LOOKUP_DELAY_MS = 350
const SHARED_LIST_REFRESH_MS = 30_000
const DAILY_BOX_FORMAT = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 })
const UPDATED_AT_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short',
})

type PopularLocationRow = {
  id: string
  location: string
}

type LocationDraft = {
  revision: number
  rows: PopularLocationRow[]
}

const EMPTY_ROWS: PopularLocationRow[] = [{ id: 'empty', location: '' }]

type PopularMonthProps = { brandId: string; month: string; onMonthChange: (month: string) => void }

export function WarehousePopularLocationsPanel({ brandId, month, onMonthChange }: PopularMonthProps) {
  const { access } = useBasicWorkAccess()
  if (!access?.brandDomains?.[brandId]?.includes('logistics')) return null
  return <SharedPopularLocations key={`${brandId}:${access.profileId}`} brandId={brandId} viewerId={access.profileId} month={month} onMonthChange={onMonthChange} />
}

function SharedPopularLocations({ brandId, viewerId, month, onMonthChange }: PopularMonthProps & { viewerId: string }) {
  useRenderWatch('WarehousePopularLocationsPanel')
  const nextId = useRef(1)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<LocationDraft | null>(null)
  const [savedNotice, setSavedNotice] = useState(false)
  const tabActive = useWorkspaceTabActivity()
  const cache = useQueryClient()
  const sharedKey = ['warehouse-popular-locations', brandId, viewerId] as const
  const shared = useQuery({
    queryKey: sharedKey,
    queryFn: ({ signal }) => readWarehousePopularLocations(brandId, signal),
    enabled: tabActive,
    refetchInterval: tabActive && open ? SHARED_LIST_REFRESH_MS : false,
  })

  const saved = shared.data?.ready ? shared.data.list : undefined
  const savedCodes = saved?.codes
  const savedRows = useMemo(
    () => savedCodes?.length ? savedCodes.map((location, index) => ({ id: `saved-${index}`, location })) : EMPTY_ROWS,
    [savedCodes],
  )
  const rows = draft?.rows ?? savedRows
  const codes = useMemo(() => [...new Set(rows.map(({ location }) => location.trim()).filter(Boolean))], [rows])
  const dirty = Boolean(saved && draft && (
    codes.length !== saved.codes.length || codes.some((code, index) => code !== saved.codes[index])
  ))

  const save = useMutation({
    mutationFn: ({ codes, revision }: { codes: string[]; revision: number }) =>
      saveWarehousePopularLocations(brandId, codes, revision),
    onSuccess: async (list) => {
      await cache.cancelQueries({ queryKey: sharedKey, exact: true })
      cache.setQueryData(sharedKey, { ready: true, list })
      setDraft(null)
      setSavedNotice(true)
    },
    onError: (error) => {
      if (error instanceof WarehousePopularLocationsChangedError) void shared.refetch()
    },
  })
  const conflict = Boolean(saved && draft && saved.revision !== draft.revision) ||
    save.error instanceof WarehousePopularLocationsChangedError

  const lookupEnabled = open && tabActive
  const hasLocations = codes.length > 0
  const validMonth = isWarehouseOutboundMonth(month)
  const outbound = useQuery({
    queryKey: ['warehouse-organization-outbound', brandId, viewerId, month],
    queryFn: ({ signal }) => readWarehouseOrganizationOutbound(brandId, month, signal),
    enabled: lookupEnabled && validMonth,
    retry: false,
  })
  const outboundRecord = outbound.data?.ready ? outbound.data.record : undefined
  const hasOutbound = Boolean(outboundRecord?.items.length)
  const inventory = useQuery({
    queryKey: ['warehouse-inventory-set', brandId],
    queryFn: () => getActiveWarehouseInventorySet(brandId),
    enabled: lookupEnabled && (hasLocations || hasOutbound),
  })
  const setId = inventory.data?.id
  const boxes = useQuery({
    queryKey: ['warehouse-stock-positions', brandId, setId, 'outbound-boxes', viewerId],
    queryFn: ({ signal }) => listWarehouseOutboundBoxQuantities(brandId, setId!, signal),
    enabled: lookupEnabled && hasOutbound && Boolean(setId),
  })
  const styles = useQuery({
    queryKey: ['styles', brandId, 'warehouse-organization-refs', viewerId],
    queryFn: () => listAllStyleRefs(brandId),
    enabled: lookupEnabled && hasOutbound,
  })
  const boxQuantities = useMemo(() => warehouseOutboundBoxQuantities(boxes.data ?? []), [boxes.data])
  const ranked = useMemo(() => warehousePopularOutboundProducts(outboundRecord?.items ?? [], month, boxQuantities), [outboundRecord, month, boxQuantities])
  const styleNumbers = useMemo(() => warehouseOutboundStyleNumbers(styles.data ?? []), [styles.data])
  const products = useMemo(() => ranked.map(item => styleNumbers.get(warehouseProductNameKey(item.productName))).filter((value): value is string => Boolean(value)), [ranked, styleNumbers])
  const unresolvedProducts = ranked.length - products.length
  const rankingMessage = !validMonth ? '출고 기준 월을 선택해 주세요.'
    : outbound.isError ? '출고 데이터를 불러오지 못했습니다.'
    : outbound.data?.ready === false ? '출고 데이터 서버 연결 대기'
    : outbound.isPending ? '출고 데이터 조회 중…'
    : !hasOutbound ? '이 달에 저장한 출고 데이터가 없습니다.'
    : inventory.isError || boxes.isError ? '박스당 수량을 불러오지 못했습니다.'
    : inventory.data === null ? '조회할 창고 재고가 없습니다.'
    : !setId || boxes.isPending ? '하루 출고 박스 수 계산 중…'
    : styles.isError ? 'M번호를 불러오지 못했습니다.'
    : styles.isPending ? 'M번호 조회 중…'
    : ranked.length === 0 ? '박스당 수량이 있는 상품이 없습니다.' : null
  const rankingReady = rankingMessage === null
  const codeKey = JSON.stringify(codes)
  const [settledCodeKey, setSettledCodeKey] = useState('[]')
  useEffect(() => {
    if (!lookupEnabled) return
    const timer = window.setTimeout(() => setSettledCodeKey(codeKey), LOCATION_LOOKUP_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [lookupEnabled, codeKey])
  const settledCodes: string[] = useMemo(() => JSON.parse(settledCodeKey), [settledCodeKey])
  const locationProducts = useQueries({
    queries: settledCodes.map(location => ({
      queryKey: ['warehouse-stock-positions', brandId, setId, 'location-products', location],
      queryFn: ({ signal }: { signal: AbortSignal }) => listWarehouseLocationProducts(brandId, setId!, location, signal),
      enabled: lookupEnabled && Boolean(setId) && settledCodeKey === codeKey,
    })),
    combine: combineListQueries<PopularLocationProduct>,
  })
  const stockReady = rankingReady && (!hasLocations || (Boolean(setId) && settledCodeKey === codeKey
    && !inventory.isError && locationProducts.errorIndexes.length === 0
    && locationProducts.data.every(items => items !== undefined)))
  const availability = useMemo(() => popularProductAvailability(products, locationProducts.data.flatMap(items => items ?? [])), [products, locationProducts.data])
  const missing = availability.filter(item => !item.available)
  const productPositions = useQuery({
    queryKey: ['warehouse-stock-positions', brandId, setId, 'popular-products', products],
    queryFn: ({ signal }) => listWarehousePopularProductPositions(brandId, setId!, products, signal),
    enabled: lookupEnabled && Boolean(setId) && rankingReady && products.length > 0,
  })
  const productRows = useMemo(() => {
    const locations = new Map(popularProductLocations(products, productPositions.data ?? []).map(row => [row.entry, row]))
    return ranked.map(item => {
      const styleNo = styleNumbers.get(warehouseProductNameKey(item.productName))
      const entry = styleNo || item.productName
      const location = locations.get(entry)
      return { ...item, entry, styleNo, location: styleNo ? location?.location : undefined,
        quantityUnknown: Boolean(styleNo && location?.quantityUnknown), matched: Boolean(location?.matched) }
    })
  }, [products, productPositions.data, ranked, styleNumbers])
  const productLookupMessage = productPositions.isError ? '조회 실패'
    : inventory.isError ? '재고 조회 실패'
    : inventory.data === null ? '현재 재고 없음'
    : !setId || productPositions.isPending ? '조회 중…' : null

  function updateRows(update: (rows: PopularLocationRow[]) => PopularLocationRow[]) {
    if (save.isPending) return
    setDraft(current => ({
      rows: update(current?.rows ?? savedRows),
      revision: current?.revision ?? saved?.revision ?? 0,
    }))
    setSavedNotice(false)
    if (save.isError && !conflict) save.reset()
  }

  function addRow() {
    const row = { id: `draft-${nextId.current++}`, location: '' }
    updateRows(current => [...current, row])
  }

  function updateRow(id: string, location: string) {
    updateRows(current => current.map(row => row.id === id ? { ...row, location } : row))
  }

  function removeRow(id: string) {
    updateRows(current => current.length === 1
      ? EMPTY_ROWS
      : current.filter(row => row.id !== id),
    )
  }

  async function loadLatest() {
    const result = await shared.refetch()
    if (!result.isSuccess || !result.data.ready) return
    setDraft(null)
    setSavedNotice(false)
    save.reset()
  }

  return (
    <details className="group mb-3 rounded-xl border border-border bg-card text-card-foreground shadow-sm"
      onToggle={event => {
        const expanded = event.currentTarget.open
        setOpen(expanded)
        if (expanded && tabActive && shared.data && !shared.isFetching) void shared.refetch()
      }}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 py-2 [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-semibold">인기상품 전용 자리</span>
        <span className="flex items-center gap-2 text-muted-foreground">
          {saved && <span className="text-xs tabular-nums">자리 {saved.codes.length.toLocaleString('ko-KR')}개</span>}
          <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="space-y-2 border-t border-border p-2">
        {shared.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-danger">
            <span>공유 자리 목록을 불러오지 못했습니다.</span>
            <Button type="button" size="sm" variant="outline" disabled={shared.isFetching}
              onClick={() => void shared.refetch()}>목록 다시 조회</Button>
          </div>
        ) : shared.data?.ready === false ? (
          <p role="status" className="text-xs text-muted-foreground">공유 저장 서버 연결 대기</p>
        ) : shared.isPending ? (
          <p role="status" className="text-xs text-muted-foreground">공유 자리 목록을 불러오는 중…</p>
        ) : null}
        {!shared.isPending && (
          <>
            {conflict ? (
              <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-warning">
                <span>공유 목록이 변경되었습니다. 최신 목록을 불러오면 입력 중인 변경은 취소됩니다.</span>
                <Button type="button" size="sm" variant="outline" disabled={shared.isFetching}
                  onClick={() => void loadLatest()}>최신 목록 불러오기</Button>
              </div>
            ) : save.isError ? (
              <p role="alert" className="text-xs text-danger">{save.error.message}</p>
            ) : savedNotice ? (
              <p role="status" className="text-xs text-success">목록을 저장했습니다.</p>
            ) : null}
            {(hasLocations || products.length > 0) && inventory.isError && !setId ? (
              <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-danger">
                창고 재고를 불러오지 못했습니다.
                <Button type="button" size="sm" variant="outline" disabled={inventory.isFetching}
                  onClick={() => void inventory.refetch()}>다시 조회</Button>
              </div>
            ) : null}
            {(hasLocations || products.length > 0) && inventory.data === null && (
              <p role="status" className="text-xs text-muted-foreground">조회할 창고 재고가 없습니다.</p>
            )}
            <div aria-label="인기상품 배치 요약" role="status" className="space-y-1 rounded-md bg-muted/50 px-2 py-1.5 text-xs">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
                <span>전용 자리 <strong>{codes.length}</strong>개</span>
                <span>인기상품 <strong>{rankingReady ? ranked.length : '—'}</strong>개</span>
                {!rankingReady && <span className="text-muted-foreground">{rankingMessage}</span>}
                {rankingReady && unresolvedProducts > 0 && <span className="text-warning">SKU 확인 필요 {unresolvedProducts}개</span>}
                {rankingReady && products.length > 0 && (stockReady ? <>
                  <span className="text-success">배치 {products.length - missing.length}개</span>
                  <span className={missing.length ? 'font-semibold text-danger' : 'text-muted-foreground'}>미배치 {missing.length}개</span>
                </> : <span className="text-muted-foreground">{inventory.isError || locationProducts.errorIndexes.length ? '재고 조회 실패 · 미배치 확인 보류' : inventory.data === null ? '조회할 재고 없음' : '재고 확인 중…'}</span>)}
                {locationProducts.errorIndexes.length > 0 && <Button type="button" size="sm" variant="outline" className="h-6 px-1.5"
                  onClick={() => locationProducts.errorIndexes.forEach(index => void cache.invalidateQueries({
                    queryKey: ['warehouse-stock-positions', brandId, setId, 'location-products', settledCodes[index]], exact: true,
                  }))}>자리 상품 다시 조회</Button>}
              </div>
              {stockReady && missing.length > 0 && <p className="max-h-14 overflow-auto break-words text-danger">미배치 · {missing.map(item => item.entry).join(' · ')}</p>}
            </div>
            <div className="grid min-w-0 gap-2 lg:grid-cols-2">
            <div className="min-w-0 self-start overflow-hidden rounded-md border border-border">
              <div className="max-h-48 overflow-auto">
              <table aria-label="인기상품 전용 자리 목록" className="w-full table-fixed text-left text-xs">
                <thead className="sticky top-0 bg-primary text-xs text-primary-foreground">
                  <tr>
                    <th scope="col" className="w-[30%] px-2 py-1.5 font-medium">전용 자리번호</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">자리의 상품</th>
                    <th scope="col" className="w-8"><span className="sr-only">관리</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row, index) => {
                    const location = row.location.trim()
                    const productIndex = codes.indexOf(location)
                    const locationItems = settledCodeKey === codeKey ? locationProducts.data[productIndex] : undefined
                    return (
                      <tr key={row.id} className="align-top">
                        <td className="p-1">
                          <Input
                            className="h-7 px-1.5 text-xs"
                            aria-label={`${index + 1}행 전용 자리번호`}
                            autoComplete="off"
                            spellCheck={false}
                            maxLength={80}
                            placeholder="3-1-1_A1"
                            value={row.location}
                            disabled={save.isPending}
                            onChange={event => updateRow(row.id, event.target.value)}
                          />
                        </td>
                        <td className="px-2 py-1.5" aria-live="polite">
                          {location && setId ? (
                            !locationItems ? (
                              <span className="text-muted-foreground">{locationProducts.errorIndexes.includes(productIndex) ? '조회 실패' : '조회 중…'}</span>
                            ) : <ul aria-label={`${location} 상품 목록`} className="space-y-0.5">
                              {locationItems.map(({ name, styleNo }) => <li key={JSON.stringify([name, styleNo])} className="break-words">
                                {name || styleNo}{name && styleNo && <span className="ml-1 text-muted-foreground">{styleNo}</span>}
                              </li>)}
                              {locationItems.length === 0 && <li className="text-muted-foreground">상품 없음</li>}
                            </ul>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {location && inventory.isPending ? '재고 확인 중…' : '—'}
                            </p>
                          )}
                        </td>
                        <td className="pt-1 text-center">
                          <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={`${index + 1}행 삭제`}
                            disabled={save.isPending || (rows.length === 1 && !row.location)} onClick={() => removeRow(row.id)}>
                            <Trash2 aria-hidden="true" className="size-3.5" />
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
              <div className="border-t border-border px-1 py-1">
                <Button type="button" size="sm" variant="ghost" className="h-6 gap-1 px-1.5" disabled={save.isPending} onClick={addRow}>
                  <Plus aria-hidden="true" className="size-3" />자리 추가
                </Button>
              </div>
            </div>
            <div className="min-w-0 self-start overflow-hidden rounded-md border border-border">
              <div className="flex items-center justify-between gap-2 bg-primary px-2 py-1 text-xs text-primary-foreground">
                <h3 className="font-medium">인기상품 리스트</h3>
                <span className="tabular-nums">하루 출고 박스 수 상위 20개</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-2 py-1 text-xs">
                <label className="flex items-center gap-1">출고 기준 월
                  <Input type="month" aria-label="인기상품 출고 기준 월" value={month} onChange={event => onMonthChange(event.target.value)} className="h-6 w-32 px-1 text-xs" />
                </label>
                <span className="text-muted-foreground">창고 정리 저장 자료 · 내림차순</span>
              </div>
              {rankingMessage && <p role="status" className="px-2 py-2 text-xs text-muted-foreground">{rankingMessage}</p>}
              {(outbound.isError || inventory.isError || boxes.isError || styles.isError) && <Button type="button" size="sm" variant="outline" className="m-1 h-6 px-1.5"
                onClick={() => { void outbound.refetch(); if (hasOutbound) { void inventory.refetch(); void styles.refetch(); if (setId) void boxes.refetch() } }}>출고 기준 다시 조회</Button>}
              {rankingReady && <>
                {productPositions.isError && <div role="alert" className="flex items-center gap-2 px-2 py-1 text-xs text-danger">
                  상품 위치를 불러오지 못했습니다.
                  <Button type="button" variant="outline" size="sm" className="h-6 px-1.5" disabled={productPositions.isFetching}
                    onClick={() => void productPositions.refetch()}>상품 위치 다시 조회</Button>
                </div>}
                <div className="max-h-48 overflow-auto">
                  <table aria-label="인기상품 현재 창고 위치" className="w-full table-fixed text-left text-xs">
                    <thead className="sticky top-0 bg-muted text-muted-foreground">
                      <tr><th scope="col" className="w-[18%] px-2 py-1.5 font-medium">M번호</th>
                        <th scope="col" className="px-2 py-1.5 font-medium">상품명</th>
                        <th scope="col" className="w-[20%] px-1 py-1.5 text-right font-medium">박스/일</th>
                        <th scope="col" className="w-[25%] px-2 py-1.5 font-medium">첫 번째 위치</th></tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {productRows.map(row => <tr key={row.index}>
                        <td className="break-words px-2 py-1.5 tabular-nums">{row.styleNo || '확인 필요'}</td>
                        <td className="break-words px-2 py-1.5">{row.productName}</td>
                        <td className="px-1 py-1.5 text-right tabular-nums">{DAILY_BOX_FORMAT.format(row.dailyBoxes)}</td>
                        <td className="break-words px-2 py-1.5">
                          {!row.styleNo ? 'SKU 확인 필요' : productLookupMessage ?? <>
                            {row.location || (row.matched ? '현재 재고 없음' : '일치 상품 없음')}
                            {row.quantityUnknown && <span className="block text-warning">수량 미확인</span>}
                          </>}
                        </td>
                      </tr>)}
                    </tbody>
                  </table>
                </div>
              </>}
            </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{dirty ? '저장하지 않은 변경' : '같은 브랜드의 물류팀이 공유하는 목록'}</span>
              <div className="flex flex-wrap items-center gap-2">
                {saved?.updatedAt && (
                  <span className="text-xs text-muted-foreground">
                    마지막 저장 <time dateTime={saved.updatedAt}>{UPDATED_AT_FORMAT.format(new Date(saved.updatedAt))}</time>
                  </span>
                )}
                <Button type="button" size="sm" className="h-7 px-2" disabled={!dirty || conflict || save.isPending}
                  onClick={() => { if (draft) save.mutate({ codes, revision: draft.revision }) }}>
                  {save.isPending ? '저장 중…' : '목록 저장'}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </details>
  )
}
