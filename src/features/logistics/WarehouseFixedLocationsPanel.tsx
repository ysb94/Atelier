import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { FilterBar } from '@/components/ui/filter-bar'
import { Input } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAuth } from '@/lib/supabase/auth'
import { requestWarehouseFixedLocations } from '@/lib/supabase/warehouse-fixed-locations'
import { useWarehouseFixedLocationSnapshot } from './use-warehouse-fixed-location-snapshot'

const PAGE_SIZE = 50
const SYNC_TIME_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  dateStyle: 'short',
  timeStyle: 'short',
})

export function WarehouseFixedLocationsPanel({ brandId }: { brandId: string }) {
  const { session } = useAuth()
  if (!session) return null
  return <FixedLocationList key={session.user.id} brandId={brandId} />
}

function FixedLocationList({ brandId }: { brandId: string }) {
  useRenderWatch('WarehouseFixedLocationsPanel')
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const { snapshot, queryKey, rows: linkedRows, styleLookup } = useWarehouseFixedLocationSnapshot(brandId)
  const syncSheet = useMutation({
    mutationFn: () => requestWarehouseFixedLocations(brandId, 'sync'),
    onSuccess: async (next) => {
      await queryClient.cancelQueries({ queryKey, exact: true })
      queryClient.setQueryData<typeof next>(queryKey, (current) =>
        current?.syncedAt && next.syncedAt && Date.parse(current.syncedAt) > Date.parse(next.syncedAt) ? current : next,
      )
    },
  })

  const syncedAt = snapshot.data?.syncedAt
  const rows = syncedAt ? linkedRows : undefined
  const error = syncSheet.error ?? snapshot.error
  const term = search.trim().toLowerCase()
  const filteredRows = rows?.filter(({ productName, location, styleNo }) =>
    productName.toLowerCase().includes(term) || location.toLowerCase().includes(term) || styleNo?.toLowerCase().includes(term),
  )
  const pageCount = Math.max(1, Math.ceil((filteredRows?.length ?? 0) / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const visibleRows = filteredRows?.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  return (
    <>
      <FilterBar>
        <Button type="button" disabled={syncSheet.isPending} onClick={() => syncSheet.mutate()}>
          {syncSheet.isPending ? '동기화 중…' : '지금 동기화'}
        </Button>
        <span className="text-sm text-muted-foreground" role="status">
          {syncedAt ? <>마지막 동기화 <time dateTime={syncedAt}>{SYNC_TIME_FORMAT.format(new Date(syncedAt))}</time></> : '마지막 동기화 기록 없음'}
        </span>
        {styleLookup.isLoading && <span className="text-sm text-muted-foreground" role="status">M번호 조회 중…</span>}
        {rows ? (
          <Input
            aria-label="상품명·M번호·고정 자리 검색"
            placeholder="상품명·M번호·고정 자리 검색"
            className="sm:max-w-xs"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
          />
        ) : null}
      </FilterBar>
      {error ? (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error.message}
          {rows ? ' 마지막으로 불러온 목록을 표시합니다.' : ''}
        </p>
      ) : null}
      {styleLookup.isError && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-danger" role="alert">
          최신 M번호를 불러오지 못했습니다.
          <Button type="button" size="sm" variant="outline" disabled={styleLookup.isFetching} onClick={() => void styleLookup.refetch()}>다시 조회</Button>
        </div>
      )}
      {rows === undefined ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {snapshot.isLoading ? '저장된 고정 자리 목록을 불러오는 중…' : '아직 동기화된 고정 자리 목록이 없습니다.'}
        </p>
      ) : visibleRows?.length ? (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm" aria-label="상품별 고정 자리">
              <thead className="bg-primary text-primary-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2">상품명</th>
                  <th scope="col" className="px-3 py-2">M번호</th>
                  <th scope="col" className="w-1/3 px-3 py-2">고정 자리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleRows.map(({ sheetRow, productName, location, styleNo }) => (
                  <tr key={sheetRow}>
                    <td className="whitespace-pre-wrap px-3 py-2">{productName || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{styleNo || '—'}</td>
                    <td className="whitespace-pre-wrap px-3 py-2">{location || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span role="status" className="text-muted-foreground">{filteredRows?.length.toLocaleString()}건</span>
            {pageCount > 1 ? (
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>이전</Button>
                <span>{currentPage} / {pageCount}</span>
                <Button type="button" variant="outline" size="sm" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>다음</Button>
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <p role="status" className="py-6 text-center text-sm text-muted-foreground">
          {rows.length ? '검색 결과가 없습니다.' : '시트에 표시할 고정 자리 데이터가 없습니다.'}
        </p>
      )}
    </>
  )
}
