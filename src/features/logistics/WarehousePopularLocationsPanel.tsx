import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { combineListQueries } from '@/lib/query/list-queries'
import { popularProductAvailability, popularProductEntries, type PopularLocationProduct } from '@/lib/warehouse/popular-products'
import { useBasicWorkAccess } from '@/lib/supabase/basic-work-access'
import {
  readWarehousePopularLocations,
  saveWarehousePopularLocations,
  WarehousePopularLocationsChangedError,
} from '@/lib/supabase/warehouse-popular-locations'
import { getActiveWarehouseInventorySet, listWarehouseLocationProducts } from '@/lib/supabase/warehouse-stock'

const LOCATION_LOOKUP_DELAY_MS = 350
const SHARED_LIST_REFRESH_MS = 30_000
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
  productText: string
}

const EMPTY_ROWS: PopularLocationRow[] = [{ id: 'empty', location: '' }]

export function WarehousePopularLocationsPanel({ brandId }: { brandId: string }) {
  const { access } = useBasicWorkAccess()
  if (!access?.brandDomains?.[brandId]?.includes('logistics')) return null
  return <SharedPopularLocations key={`${brandId}:${access.profileId}`} brandId={brandId} viewerId={access.profileId} />
}

function SharedPopularLocations({ brandId, viewerId }: { brandId: string; viewerId: string }) {
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
  const productText = draft?.productText ?? saved?.products.join('\n') ?? ''
  const products = useMemo(() => popularProductEntries(productText), [productText])
  const productsDirty = Boolean(saved && (products.length !== saved.products.length || products.some((item, index) => item !== saved.products[index])))
  const dirty = Boolean(saved && draft && (
    productsDirty || codes.length !== saved.codes.length || codes.some((code, index) => code !== saved.codes[index])
  ))

  const save = useMutation({
    mutationFn: ({ codes, revision, products }: { codes: string[]; revision: number; products?: string[] }) =>
      saveWarehousePopularLocations(brandId, codes, revision, products),
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
  const inventory = useQuery({
    queryKey: ['warehouse-inventory-set', brandId],
    queryFn: () => getActiveWarehouseInventorySet(brandId),
    enabled: lookupEnabled && hasLocations,
  })
  const setId = inventory.data?.id
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
  const stockReady = !hasLocations || (Boolean(setId) && settledCodeKey === codeKey
    && !inventory.isError && locationProducts.errorIndexes.length === 0
    && locationProducts.data.every(items => items !== undefined))
  const availability = useMemo(() => popularProductAvailability(products, locationProducts.data.flatMap(items => items ?? [])), [products, locationProducts.data])
  const missing = availability.filter(item => !item.available)

  function updateRows(update: (rows: PopularLocationRow[]) => PopularLocationRow[]) {
    if (save.isPending) return
    setDraft(current => ({
      rows: update(current?.rows ?? savedRows),
      productText: current?.productText ?? productText,
      revision: current?.revision ?? saved?.revision ?? 0,
    }))
    setSavedNotice(false)
    if (save.isError && !conflict) save.reset()
  }

  function updateProducts(productText: string) {
    if (save.isPending) return
    setDraft(current => ({ rows: current?.rows ?? savedRows, productText, revision: current?.revision ?? saved?.revision ?? 0 }))
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
            {hasLocations && inventory.isError && !setId ? (
              <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-danger">
                창고 재고를 불러오지 못했습니다.
                <Button type="button" size="sm" variant="outline" disabled={inventory.isFetching}
                  onClick={() => void inventory.refetch()}>다시 조회</Button>
              </div>
            ) : null}
            {hasLocations && inventory.data === null && (
              <p role="status" className="text-xs text-muted-foreground">조회할 창고 재고가 없습니다.</p>
            )}
            <div aria-label="인기상품 배치 요약" role="status" className="space-y-1 rounded-md bg-muted/50 px-2 py-1.5 text-xs">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
                <span>전용 자리 <strong>{codes.length}</strong>개</span>
                <span>인기상품 <strong>{products.length}</strong>개</span>
                {products.length > 0 && (stockReady ? <>
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
              <h3 className="bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground">인기상품 리스트</h3>
              <div className="space-y-1 p-1.5">
                <p id={`popular-products-help-${brandId}`} className="text-xs text-muted-foreground">M번호 또는 정확한 상품명을 한 줄에 하나씩 입력하세요.</p>
                <Textarea aria-label="인기상품 리스트" aria-describedby={`popular-products-help-${brandId}`} value={productText}
                  onChange={event => updateProducts(event.target.value)} disabled={save.isPending}
                  rows={5} className="h-32 resize-y px-2 py-1 text-xs leading-6" placeholder={'M0001\nM0002\n상품명'} />
              </div>
            </div>
            </div>
            {saved && !saved.productsReady && <p className="text-xs text-muted-foreground">인기상품 공유 저장은 서버 적용 후 사용할 수 있습니다.</p>}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{dirty ? '저장하지 않은 변경' : '같은 브랜드의 물류팀이 공유하는 목록'}</span>
              <div className="flex flex-wrap items-center gap-2">
                {saved?.updatedAt && (
                  <span className="text-xs text-muted-foreground">
                    마지막 저장 <time dateTime={saved.updatedAt}>{UPDATED_AT_FORMAT.format(new Date(saved.updatedAt))}</time>
                  </span>
                )}
                <Button type="button" size="sm" className="h-7 px-2" disabled={!dirty || conflict || save.isPending || (productsDirty && !saved?.productsReady)}
                  onClick={() => { if (draft) save.mutate({ codes, revision: draft.revision, products: saved?.productsReady ? products : undefined }) }}>
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
