import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
}

const EMPTY_ROWS: PopularLocationRow[] = [{ id: 'empty', location: '' }]

function LocationProducts({ brandId, setId, location, enabled }: {
  brandId: string
  setId: string
  location: string
  enabled: boolean
}) {
  const [settledLocation, setSettledLocation] = useState('')
  useEffect(() => {
    if (!enabled) return
    const timer = window.setTimeout(() => setSettledLocation(location), LOCATION_LOOKUP_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [enabled, location])

  const code = settledLocation === location ? location : ''
  const products = useQuery({
    queryKey: ['warehouse-stock-positions', brandId, setId, 'location-products', code],
    queryFn: ({ signal }) => listWarehouseLocationProducts(brandId, setId, code, signal),
    enabled: enabled && Boolean(code),
  })

  if (!code || products.isPending) {
    return <p className="text-xs text-muted-foreground">상품 조회 중…</p>
  }
  if (products.isError) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-danger">
        상품을 불러오지 못했습니다.
        <Button type="button" size="sm" variant="outline" disabled={products.isFetching}
          aria-label={`${location} 상품 다시 조회`} onClick={() => void products.refetch()}>
          다시 조회
        </Button>
      </div>
    )
  }
  if (products.data.length === 0) {
    return <p className="text-xs text-muted-foreground">이 자리에 있는 상품이 없습니다.</p>
  }
  return (
    <ul aria-label={`${location} 상품 목록`} className="space-y-1">
      {products.data.map(({ name, styleNo }) => (
        <li key={JSON.stringify([name, styleNo])} className="flex flex-wrap items-baseline gap-x-2 break-words">
          <span className="min-w-0 font-medium">{name || styleNo}</span>
          {name && styleNo && <span className="min-w-0 text-xs text-muted-foreground">{styleNo}</span>}
        </li>
      ))}
    </ul>
  )
}

export function WarehousePopularLocationsPanel({ brandId }: { brandId: string }) {
  const { access } = useBasicWorkAccess()
  if (!access?.brandDomains?.[brandId]?.includes('logistics')) return null
  return <SharedPopularLocations key={access.profileId} brandId={brandId} viewerId={access.profileId} />
}

function SharedPopularLocations({ brandId, viewerId }: { brandId: string; viewerId: string }) {
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
  const codes = [...new Set(rows.map(({ location }) => location.trim()).filter(Boolean))]
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
  const inventory = useQuery({
    queryKey: ['warehouse-inventory-set', brandId],
    queryFn: () => getActiveWarehouseInventorySet(brandId),
    enabled: lookupEnabled && hasLocations,
  })
  const setId = inventory.data?.id

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
    <details className="group mb-6 rounded-xl border border-border bg-card text-card-foreground shadow-sm"
      onToggle={event => {
        const expanded = event.currentTarget.open
        setOpen(expanded)
        if (expanded && tabActive && shared.data && !shared.isFetching) void shared.refetch()
      }}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-semibold">인기상품 전용 자리</span>
        <span className="flex items-center gap-2 text-muted-foreground">
          {saved && <span className="text-xs tabular-nums">자리 {saved.codes.length.toLocaleString('ko-KR')}개</span>}
          <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="space-y-3 border-t border-border p-4">
        <p className="text-xs text-muted-foreground">
          자리번호를 입력하면 현재 상품이 표시됩니다. 목록을 저장하면 같은 브랜드의 물류팀이 볼 수 있습니다.
        </p>
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
              <p role="status" className="text-xs text-success">자리 목록을 저장했습니다.</p>
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
            <div className="max-w-3xl overflow-hidden rounded-lg border border-border">
              <table aria-label="인기상품 전용 자리 목록" className="w-full table-fixed text-left text-sm">
                <thead className="bg-primary text-xs text-primary-foreground">
                  <tr>
                    <th scope="col" className="w-[38%] px-3 py-2 font-medium">전용 자리번호</th>
                    <th scope="col" className="px-3 py-2 font-medium">자리의 상품</th>
                    <th scope="col" className="w-11"><span className="sr-only">관리</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row, index) => {
                    const location = row.location.trim()
                    return (
                      <tr key={row.id} className="align-top">
                        <td className="p-2">
                          <Input
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
                        <td className="px-3 py-4" aria-live="polite">
                          {location && setId ? (
                            <LocationProducts brandId={brandId} setId={setId} location={location} enabled={lookupEnabled} />
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {location && inventory.isPending ? '재고 확인 중…' : '—'}
                            </p>
                          )}
                        </td>
                        <td className="pt-2 text-center">
                          <Button type="button" size="icon" variant="ghost" aria-label={`${index + 1}행 삭제`}
                            disabled={save.isPending || (rows.length === 1 && !row.location)} onClick={() => removeRow(row.id)}>
                            <Trash2 aria-hidden="true" className="size-4" />
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex max-w-3xl flex-wrap items-center justify-between gap-2">
              <Button type="button" size="sm" variant="outline" disabled={save.isPending} onClick={addRow}>
                <Plus aria-hidden="true" className="size-3.5" />
                행 추가
              </Button>
              <div className="flex flex-wrap items-center gap-2">
                {saved?.updatedAt && (
                  <span className="text-xs text-muted-foreground">
                    마지막 저장 <time dateTime={saved.updatedAt}>{UPDATED_AT_FORMAT.format(new Date(saved.updatedAt))}</time>
                  </span>
                )}
                <Button type="button" size="sm" disabled={!dirty || conflict || save.isPending}
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
